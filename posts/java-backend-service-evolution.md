---
title: 退款前查过额度了，为什么还是会超退
date: 2026-04-28
updated: 2026-10-23
category: Java 后端
description: 两个请求都查到可退 100 元，然后各退 70 元。把这个顺序放进 SQL，看事务和条件更新分别能管住什么。
---

# 退款前查过额度了，为什么还是会超退

退款接口里有一段很容易写出来的逻辑：查订单，算剩余可退金额，够就建立退款单，再扣掉额度。

```java
long available = budgetRepository.findAvailable(orderId);
if (available < amount) {
    throw new InsufficientRefundBudgetException();
}
refundRepository.create(refundId, orderId, amount);
budgetRepository.deduct(orderId, amount);
```

这段省略了事务和异常处理，但即使先补一个 `@Transactional`，也不能马上说它安全了。在允许两个事务同时读到同一旧值的隔离级别下，两个请求都能通过前面的判断。

比如可退 100 元，A 和 B 各申请退 70 元：

```text
A 查询：还剩 100，通过
B 查询：还剩 100，通过
A 建立退款单，扣 70
B 建立退款单，再扣 70
```

把查询从 Controller 搬到 Service，或者把条件封装成 `canRefund()`，都不会改变这个交错顺序。

## 真正需要抢的是那次额度变更

先不用 Java，在 SQLite 里建一张简化的额度表。金额单位是分：

```sql
CREATE TABLE refund_budget (
    order_id TEXT PRIMARY KEY,
    available_cents INTEGER NOT NULL
);
INSERT INTO refund_budget VALUES ('o-001', 10000);
```

不附带条件地扣两次，结果就是负数：

```sql
UPDATE refund_budget
SET available_cents = available_cents - 7000
WHERE order_id = 'o-001';

UPDATE refund_budget
SET available_cents = available_cents - 7000
WHERE order_id = 'o-001';

SELECT available_cents FROM refund_budget;
-- -4000
```

把表复原，再把余额判断放进更新语句：

```sql
UPDATE refund_budget SET available_cents = 10000;

UPDATE refund_budget
SET available_cents = available_cents - 7000
WHERE order_id = 'o-001' AND available_cents >= 7000;
SELECT changes();
-- 1

UPDATE refund_budget
SET available_cents = available_cents - 7000
WHERE order_id = 'o-001' AND available_cents >= 7000;
SELECT changes();
-- 0
```

`changes()` 是 SQLite 查看上一条语句影响行数的函数。Java 代码里应取数据库驱动返回的更新行数。第二次更新已经扣不动了，应用需要把这个零行结果当成占用失败，而不能继续往下执行。

数据库可以用行锁、条件更新或更强的事务隔离解决竞争。这里用条件更新，是因为这个约束能直接写成一行 SQL；如果改用 `SELECT ... FOR UPDATE`，同样要保证查询和扣减处于同一个事务里。

## 扣到了额度，退款单却没建成怎么办

假如更新额度成功，插入退款单却因为唯一键冲突失败，额度不能凭空少掉。扣减和建立退款单仍要放在同一本地事务中。

我更愿意先尝试插入带唯一业务键的退款请求，再执行条件扣减。插入失败就退出这次事务；扣减零行也回滚，连同刚插入的请求一起撤掉。这里的退款请求应带上订单、金额、币种等内容，处理重复键时才能判断是不是同一份请求。

对于真正的重复请求，读取已有退款单并返回它的状态即可。同一个幂等键却换了金额，就应报冲突，不能只因为“键已存在”就返回成功。

这也解释了为什么幂等和余额并发控制需要分开做。两个不同的退款单号可以同时退同一订单，它们不会触发请求唯一键冲突，却会竞争同一笔剩余额度。

## 到这里，本地事务才管完自己的事

占用额度和建立请求成功以后，还没有真正把钱退给用户。渠道调用不能靠这笔数据库事务一起回滚。可以在同一个事务里留下待发送任务，再按渠道的幂等协议执行退款；结果不明时继续查询，不能马上释放额度让另一笔退款再用一次。

这篇只把问题收在“建立请求时不超占额度”这一段。最有价值的测试也很短：初始额度 100 元，用两个不同请求各占 70 元，最后只能有一笔占用成功；再重放成功的那个请求，余额应保持 30 元。相比正常调用十次，这个顺序更容易暴露那段查询到底有没有守住边界。
