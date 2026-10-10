# 一、类型系统：把「会变的数据」说清楚

> 对应答案：[01-typescript.md](../01-typescript.md)，原题 1、2、5、7。
> 读完要能讲清：编译期类型和运行时数据各管什么；泛型、查表、条件类型怎样配合；类型守卫和 `as` 差在哪；判别联合怎样排除矛盾状态；流式事件为什么要和传输通道分开。

## 这章在解决什么问题

AI 应用里的数据有三层不稳定：

1. **接口很多，外壳却一样。** 「发消息」和「查用量」都是一次请求，参数和返回值完全不同。
2. **网上来的 JSON 不听编译器的。** 模型一升级，字段可能改名或换位置。
3. **一次任务会换好几种形态。** 排队、执行、等审批、结束，每种形态带的数据不一样。硬用几个布尔值，会出现「已经完成了却还在等审批」。

TypeScript 能帮你的，是在**写代码时**把这三层说死。它不能替你检查网络上真的来了什么。这一章就围绕这条分界展开。

## 如果这些词生疏

**补充知识**（答案默认你会，这里只垫底）：

- **类型标注**写在代码里，例如 `text: string`。编译结束后，这些标注不会留在跑起来的 JavaScript 里。所以类型错了，程序照样可能跑；类型对了，坏 JSON 也照样能进来。
- **联合类型** `A | B` 表示「不是 A 就是 B」。
- **泛型参数**是类型上的一个洞。调用时把具体类型填进去，同一段外壳就能复用。

## 1. 先固定外壳，再把会变的部分留成洞

一个请求无论成功失败，调用方都要同一套处理：成功拿数据，失败拿错误。这个外壳不该每种接口重写一遍。

```ts
type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
```

`T` 就是那个洞。发消息时 `T` 是 `{ queueId: string }`，查用量时 `T` 是 `{ used: number }`。外壳的形状不变，里面的数据变。

这解决的是**重复**，还没解决**写错方法名却不报错**。如果函数写成 `request(method: string, params: any)`，编译器无法知道这次该传 `text` 还是 `provider`。

## 2. 用方法名查表，让参数和返回值一起被推断

把「方法名 → 参数」和「方法名 → 返回值」写成两张类型表。函数的泛型 `M` 被收成表的键，参数用 `Params[M]`，返回值用 `Outputs[M]`。传入具体方法名之后，`M` 不再是「任意键」，而是 `'send'` 或 `'usage'` 里的那一个。

```ts
type Params = {
  send: { text: string };
  usage: { provider: string };
};
type Outputs = {
  send: { queueId: string };
  usage: { used: number };
};

declare function request<M extends keyof Params>(
  method: M,
  params: Params[M],
): Promise<Outputs[M]>;

request('send', { text: '修复报错' });
// 返回类型是 Promise<{ queueId: string }>
```

这里有三步，缺一不可：

| 写法 | 它在做什么 |
| --- | --- |
| `M extends keyof Params` | `M` 只能是表里有的方法名 |
| `Params[M]` | 用这次的方法名去查参数类型 |
| `Outputs[M]` | 用同一次方法名去查返回类型 |

`keyof`、索引访问 `Params[M]` 都发生在编译期。你写成 `request('send', { provider: 'x' })`，编译器直接报错，因为 `'send'` 这一格的参数里没有 `provider`。

**为什么需要查表，而不是每个方法写一个函数？** 方法少的时候，分开写更直白。方法几十个、又要走同一条 IPC 或 HTTP 通道时，查表让通道只有一个入口，类型仍然按方法名分叉。

## 3. 条件类型：从包着的类型里把内芯取出来

有时你拿到的是「包了一层的类型」，想要里面那层。条件类型的形状是：如果 `T` 长得像某种样子，结果用一种类型，否则用另一种。

```ts
type Unwrap<T> = T extends Promise<infer U> ? U : T;

type A = Unwrap<Promise<{ queueId: string }>>; // { queueId: string }
type B = Unwrap<string>;                       // string
```

`infer U` 的意思是：这里有一个当时还不知道的类型，请编译器从匹配到的结构里把它认出来。`Promise<infer U>` 匹配成功时，`U` 就是 Promise 里包着的那个类型。

**补充知识：** 条件类型和泛型都在编译期计算，不会在运行时去「拆开一个 Promise」。运行时要等 Promise 完成，用的是 `await`，那是另一回事。

它解决的问题是类型层面的抽取：比如一个辅助类型想说「如果返回值是 Promise，就谈里面的结果，否则就谈它本身」。业务代码里更常见的仍是上一节的查表；条件类型是查表不够用时的提取工具。

## 4. 类型只管写代码。进来的数据要从 unknown 起步

模型版本一变，JSON 可能从 `{ text }` 变成 `{ delta: { content } }`。你在类型里写得再精确，`JSON.parse` 的结果在类型上通常只是你断言过的样子，运行时不会自动核对。

稳妥的起点是把外部数据看成 `unknown`：编译器拒绝你直接读 `.text`，直到你证明它真有这个字段。

类型守卫是一个返回 `value is X` 的函数。返回 `true` 时，调用方后面的代码可以把这个值当 `X` 用。

```ts
function hasText(value: unknown): value is { text: string } {
  return typeof value === 'object'
    && value !== null
    && 'text' in value
    && typeof value.text === 'string';
}

function readText(value: unknown) {
  if (!hasText(value)) return;
  return value.text; // 这里才允许读
}
```

收窄按这个顺序走，跳步就会误判：

```
是不是对象（并且不是 null）
  → 用 type 或版本字段判断是哪一种格式
  → 再检查这种格式必有的字段和类型
  → 通过了，才交给页面
```

版本差异放在适配器里消化：旧版认 `text`，新版认 `delta.content`，两边都输出同一种「文本增量」。页面只认这一种。缺了关键字段，应当报告协议错误；多出来的不认识字段可以忽略，这样模型新增字段时页面不会被弄坏。

### `as` 和类型守卫

| | `as X` | 类型守卫 |
| --- | --- | --- |
| 何时发生 | 只影响编译器 | 运行时真的检查 |
| 数据是坏的时 | 编译通过，运行时照样崩或误用 | 检查失败，不进入 `X` 那个分支 |
| 适合 | 你已用别的办法证明过，只是编译器跟不上 | 一切来自网络、磁盘、别的进程的数据 |

`as` 是让编译器闭嘴，不是检查。

## 5. 状态用判别联合，避免「自相矛盾的布尔值」

如果状态是三个布尔值：`running`、`waiting`、`done`，类型允许它们同时为 `true`。程序里就会出现写得通、业务上不可能的组合。

判别联合用一个公共字段区分形态，每种形态只带自己需要的数据：

```ts
type RunState =
  | { status: 'running'; runId: string }
  | { status: 'waiting'; runId: string; requestId: string }
  | { status: 'completed'; runId: string };
```

`status` 叫判别字段。`switch (state.status)` 时，进入 `'waiting'` 分支就能读 `requestId`，进入 `'completed'` 就读不到，因为那种形态里根本没有这个字段。

合法的转移可以画成：

```
queued → running → completed
                 → failed
                 → cancelled
                 → waiting → running   （审批完再继续）
```

类型还能限制「谁可以调用这个函数」。`Extract<RunState, { status: 'waiting' }>` 从联合里只取出等待态，于是 `approve` 在编译期就不接受完成态：

```ts
function approve(
  state: Extract<RunState, { status: 'waiting' }>,
  requestId: string,
): Extract<RunState, { status: 'running' }> {
  if (state.requestId !== requestId) throw new Error('审批已失效');
  return { status: 'running', runId: state.runId };
}
```

函数签名只保证：**调用方如果把别的状态传进来，编译失败；调用方如果先读到当前状态再传进来，编译器相信你已经收窄过。** 来自网络的「批准」仍然要在运行时核对：当前是不是还在等待、`requestId` 是不是这一次的。类型防止的是漏写字段和漏写分支，防止不了迟到的事件。

上面的 `approve` 只演示状态怎么变。它没有包含「把批准发给代理」这个副作用。副作用要另写，并且写在你确认状态合法之后。

### 布尔值和判别联合

| | 多个布尔值 | 判别联合 |
| --- | --- | --- |
| 表达 | 每个旗标各自真假 | 同一时刻只有一种形态 |
| 附带数据 | 所有字段永远都在，用不用靠人记得 | 只有这种形态才有的字段，别的形态上看不见 |
| 漏掉一种情况 | 容易悄悄落到默认组合 | `switch` 可以要求写全每种 `status` |

## 6. 流式事件和运输它的通道是两件事

页面真正关心三件事：来了一段正文、出错了、结束了。SSE 和 WebSocket 只是把这些事件搬过来的通道。通道换了，后面的处理不该重写。

```ts
type StreamEvent<T> =
  | { type: 'chunk'; runId: string; seq: number; data: T }
  | { type: 'error'; runId: string; message: string }
  | { type: 'done'; runId: string };
```

`T` 让同一套事件既能装文本，也能装结构化片段。`seq` 用来发现重复或跳号，下一章会展开。

还要事先分开两种错误：

| 错误 | 例子 | 页面通常怎么做 |
| --- | --- | --- |
| 传输错误 | 断网、连接被关掉 | 可以按规则重连、补拉 |
| 业务错误 | 额度不足、模型拒绝 | 提示用户，保留已收到的内容 |

连接断开，只说明通道没了，不说明服务端任务已经停。要停止生成，需要单独发取消请求。这条在流式那章会反复出现，类型层面先把 `error` 和「连接没了」留成不同的情况，后面才拆得开。

## 容易混在一起

**泛型、联合、条件类型、守卫，各管一步：**

```
泛型        同一个外壳，内芯以后再填
查表        用方法名决定这次的内芯是什么
条件类型    从已有类型里抽出里面那一层
类型守卫    运行时证明「这份未知数据」真的是那种内芯
判别联合    几种形态互斥，每种带自己的字段
```

**「编译器相信你」和「数据真的对」：** 函数参数写成等待态，只说明调用方在类型上收窄过。网络请求仍要核对当前状态和 `runId`。

## Moose 这一章实际落在哪

以下只复述 [答案](../01-typescript.md) 里核对过的事实。

- `shared/types.ts` 定义 `Method`、`Requests`、`Responses`。`window.moose.request` 用方法名约束参数和返回类型。IPC 入口再用 Zod 校验实际传入的数据。
- `shared/validation.ts` 用 Zod 校验 IPC 参数。各代理适配器把 CLI 的原始事件转成统一的 `AgentEvent`，页面不直接依赖某个 CLI 的字段。
- 状态用 `Status` 字符串联合表示 idle、queued、running、waiting 等。Service 在运行时检查审批是不是当前待处理的请求。**没有**完整的类型级状态机。
- 适配器把各 CLI 的 stdio 消息转成统一的 `AgentEvent`。Web 页面通过 HTTP 发请求、通过 SSE 收业务事件，不直接读取 CLI 输出。

通用示例里的 `approve`、`StreamEvent`、`hasText` 是讲法，不是 Moose 源码。

## 本章速记

接口外壳固定，变化的参数和返回值用方法名查表，编译器才能在你写错字段时拦住你。条件类型负责从类型里抽出内芯，比如把 `Promise` 里面的类型拿出来。这些都只在编译期发生。网络和 CLI 来的数据先当 `unknown`，用类型守卫逐项证明，再收成页面统一的形状；缺关键字段报协议错误，多出来的字段可以忽略。`as` 只是让编译器闭嘴。任务状态用判别联合，一种形态一份数据，切换函数只接受合法的那一种形态；运行时仍要核对当前状态和任务 ID。流式则先定义与通道无关的事件：片段、错误、结束。断线和模型报错分开，断开连接也不等于任务已取消。

合上文件试着讲：为什么 `request('send', …)` 能推出返回类型？为什么守卫比 `as` 多做了一步？为什么完成态不该带 `requestId`？
