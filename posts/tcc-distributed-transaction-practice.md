---
title: TCC 的 Cancel 查不到记录，能直接返回吗
date: 2025-08-15
updated: 2026-10-23
category: 分布式
description: Cancel 比 Try 先到时，返回成功还不够。用一条取消记录拦住迟到的 Try，再看唯一键为什么也在协议里面。
---

# TCC 的 Cancel 查不到记录，能直接返回吗

写一个资源预留接口，Try 负责冻结，Confirm 负责确认占用，Cancel 负责释放。按顺序调用时挺容易理解。麻烦出在这段看起来很体贴的 Cancel 代码：

```java
var branch = branchRepository.find(xid, branchId);
if (branch == null) {
    return; // 没冻结过，自然也不用释放
}
release(branch);
```

“不释放”这个判断没错，但直接返回，漏掉了一个还没到的请求。

## 超时没有把请求从网络里撤回来

协调器调用 Try 超时，决定取消。可能 Try 真的没发出去，也可能请求只是在路上耽搁了。后者可以排出这样的顺序：

```text
协调器发送 Try，请求延迟
协调器等到超时，发送 Cancel
参与者处理 Cancel：查不到分支，返回成功
协调器认为取消完成
迟到的 Try 抵达，冻结资源
```

现在冻结已经发生，协调器却没有理由再发一次 Cancel。这笔资源就挂在那里了。

空回滚与悬挂在这里是同一条时序的前后两段。单看 Cancel，它什么也没做；把迟到的 Try 接上，才看得出为什么“什么也没做”也需要留下记录。

## 给没发生过的 Try 留一个取消结果

先用一张简化的分支表说明。这不是完整的账务表，只保存协调所需的状态：

```sql
CREATE TABLE tcc_branch (
    xid TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    state TEXT NOT NULL,
    PRIMARY KEY (xid, branch_id)
);
```

当 Cancel 确认分支尚不存在时，写入：

```sql
INSERT INTO tcc_branch (xid, branch_id, state)
VALUES ('g-001', 'reserve-balance', 'CANCELLED');
```

这条记录不对应一次资源释放。它表达的是：这个分支已经决定取消，以后不能再预留。

迟到的 Try 使用相同的 `(xid, branch_id)`，会碰到已有记录。读出 `CANCELLED` 后拒绝执行，不碰余额。正常 Try 则在本地事务里把分支写成 `TRIED`，并完成资源预留；两件事一起提交，不能留下“有分支没冻结”或者“冻结了没分支”的半截结果。

分支键里要有 `branch_id`。同一笔全局事务可能在同一个参与者中调用不止一个分支，只用全局事务 ID 会把它们挤成一条记录。

## 又回到了插入竞争

那能不能先 `SELECT` 一下，没记录就各做各的？不行，Try 和 Cancel 都可能先查到空。

Try 准备插 `TRIED`，Cancel 准备插 `CANCELLED`。唯一键让它们不能各自成功创建一条同名分支。插入冲突的一方需要先结束失败的本地事务，再读取获胜一方已提交的状态，按那个结果继续处理，不能把冲突吞掉当成功。

如果 Try 先提交，Cancel 看到的是 `TRIED`，需要在本地事务中释放预留并改为 `CANCELLED`；如果 Cancel 先提交，Try 看到的就是禁止预留的记录。后续处理已有分支时，状态判断、资源变更和状态落库也必须在同一本地事务里完成，靠行锁或条件更新挡住重复执行。

这不是把一个 `if` 再写严谨一点。分支唯一键、事务和状态机一起构成了这段协议，少一个都可能换一种方式出错。

取消记录也不能随手设个很短的 TTL 清掉。清完以后，如果旧 Try 仍能被重放，刚才堵住的洞又开了。保留周期需要与协调器的恢复和重试规则对应，全局事务 ID 也不能复用。

这篇用的是可以预留、释放的内部资源。如果参与者是一个没有 Try/Cancel 能力的外部退款渠道，存一张分支表并不能让已经发生的退款撤销；那是另一条需要查询与对账的资金链路。
