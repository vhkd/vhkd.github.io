---
title: 从 .NET 到 Java：Service 里这个字段能不能留
date: 2024-03-07
updated: 2026-10-23
featured: 1
category: 后端随笔
description: AddScoped 和 Spring 默认单例之间，差的不只是一个注册方法。用一次导出请求看共享字段如何串数据。
---

# 从 .NET 到 Java：Service 里这个字段能不能留

从 C# 转到 Java，有些代码几乎可以照着写：构造器注入、调用 Repository、拼一个返回结果。类还是那个类，方法也还是那个方法，所以容易顺手把字段一起搬过去。

但这个字段可能已经换了主人。

比如一个导出服务，把当前用户 ID 暂存在实例上。下面省略依赖声明，只看用户 ID 在哪里被读写：

```java
@Service
public class ExportService {
    private String currentUserId;

    public void export(String userId) {
        currentUserId = userId;
        var orders = orderRepository.findByUserId(currentUserId);
        fileStorage.save(currentUserId, orders);
    }
}
```

单个请求跑起来没问题。查询拿到了订单，文件也存到了对应用户下面。危险的地方在于，`findByUserId` 要等数据库，这段等待给了另一个请求修改字段的机会。

## 两个请求共用了哪个对象

在 ASP.NET Core 中，如果服务是这样注册的：

```csharp
builder.Services.AddScoped<ExportService>();
```

正常的 HTTP 请求作用域内，同一个请求复用一个实例，不同请求各拿各的实例。把当前用户存在实例字段里，虽然增加了方法之间的隐式依赖，但不会仅仅因为两个 HTTP 请求同时到来就串在一起。

Spring 的 `@Service` 默认是容器内单例。两个请求进入 `export`，操作的是同一个 `currentUserId`。可以按下面的顺序读一遍代码：

```text
请求 A：currentUserId = "alice"
请求 A：开始查询 alice 的订单，等待数据库
请求 B：currentUserId = "bob"
请求 A：查询返回，把订单保存到 currentUserId 对应的目录
```

最后一行读到的是 `bob`，订单却是 Alice 的。这里没有复杂的锁竞争算法，甚至不需要两个线程在同一条语句上撞到一起。只要字段在查询前后被读了两次，就有可能读出两个值。

`volatile` 也救不了这个写法。它能约束字段的可见性，不能让“赋值、查询、保存”变成不可打断的一整个操作。这个例子里，A 看见 B 的新值恰好就是问题。

## 用户 ID 本来就不需要存在服务上

我会直接让这个值留在参数和局部变量里：

```java
public void export(String userId) {
    var orders = orderRepository.findByUserId(userId);
    fileStorage.save(userId, orders);
}
```

两个调用各自有自己的参数。等数据库再久，也不会因为另一个调用进来就改变用户 ID。服务实例仍然可以共享 Repository 和存储客户端，前提是这些依赖本身适合并发使用。

给整个方法加 `synchronized` 能挡住这个例子中的交错，但所有用户的导出也被排成了一条队。仅仅为了留住一个不必存在的字段，就把数据库等待时间一起锁进去，我觉得不划算。

改成 request scope 也是一个选项，不过它改变了对象的生命周期，还会涉及代理和后台任务中没有请求上下文的问题。这里只是传一个用户 ID，参数已经够用了。

反过来，C# 的 scoped 也不是“线程安全”的同义词。同一个请求中用 `Task.WhenAll` 并发调用这个服务，仍可能同时读写同一实例。把状态移回局部变量的好处，在两边都成立。

现在看到 Service 的实例字段，我会多停一下：这个值是服务长期持有的依赖，还是某一次调用留下的东西？从 .NET 换到 Java，这个问题比类名和注解怎么对应更值得先问。

关于默认生命周期，可以对照 [ASP.NET Core 的服务生命周期说明](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/dependency-injection#service-lifetimes) 和 [Spring Bean scopes](https://docs.spring.io/spring-framework/reference/core/beans/factory-scopes.html)。
