# 一、类型：把会变的数据说清楚

> 对应答案：[01-typescript.md](../01-typescript.md)，原题 1、2、5、7。

发消息和查用量都是一次请求。外壳一样：成功拿数据，失败拿错误。里面不一样：一个要 `text`，一个要 `provider`。这一章先把外壳固定住，再让方法名决定里面填什么。类型只能管到你写代码的时候。网上来的 JSON、任务换状态、流式事件，都得在这个界限之后再谈。

## 外壳留一个洞

成功和失败的处理，每种接口都一样，不必重写。

```ts
type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
```

`T` 是类型上留的洞。发消息时填 `{ queueId: string }`，查用量时填 `{ used: number }`。外壳不动，里面的数据变。

类型标注，比如 `text: string`，编译结束以后不会留在跑起来的 JavaScript 里。联合类型 `A | B` 表示不是 A 就是 B。泛型就是上面那个洞，调用时把具体类型填进去。

这一步只去掉了重复。函数如果写成 `request(method: string, params: any)`，编译器仍然不知道这次该传 `text` 还是 `provider`。

## 用方法名把洞填上

上一节的 `T` 还是调用的人自己填。方法一多，就会填错。把「方法名 → 参数」和「方法名 → 返回值」写成两张表，让这一次传入的方法名同时决定两格。

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

`M extends keyof Params` 把方法名限制在表里。`Params[M]` 查参数，`Outputs[M]` 用同一次方法名查返回值。这些都发生在编译期。`request('send', { provider: 'x' })` 会报错，因为 `'send'` 那一格没有 `provider`。

方法少的时候，每个方法写一个函数更直白。方法有几十个、又要走同一条 IPC 或 HTTP 时，查表让通道只有一个入口，类型仍然按方法名分开。

## 查表不够时，再从类型里抽出里面那层

有时你拿到的不是表里的一格，而是包了一层的类型，想要里面那层。条件类型的写法是：如果 `T` 长得像某种样子，就用一种结果，否则用另一种。

```ts
type Unwrap<T> = T extends Promise<infer U> ? U : T;

type A = Unwrap<Promise<{ queueId: string }>>; // { queueId: string }
type B = Unwrap<string>;                       // string
```

`infer U` 的意思是：这里有一个当时还不知道的类型，请编译器从匹配到的结构里把它认出来。`Promise<infer U>` 对上了，`U` 就是 Promise 里包着的那个类型。

这也只在编译期发生。运行时要等 Promise 完成，用的是 `await`。业务代码里更常见的仍是上一节的查表。条件类型是查表不够、需要拆开已有类型时才用。

## 编译期到此为止，进来的数据要自己证明

上面三节都管「你写下的类型」。模型一升级，JSON 可能从 `{ text }` 变成 `{ delta: { content } }`。`JSON.parse` 不会按你的类型去核对。

把外部数据先看成 `unknown`。编译器会拒绝你直接读 `.text`，直到你证明它真有这个字段。类型守卫是一个返回 `value is X` 的函数。它返回 `true` 之后，后面的代码才能把这个值当 `X` 用。

```ts
function hasText(value: unknown): value is { text: string } {
  return typeof value === 'object'
    && value !== null
    && 'text' in value
    && typeof value.text === 'string';
}
```

证明要按顺序走。先确认是对象，而且不是 `null`。再用 `type` 或版本字段判断是哪一种格式。然后检查这种格式必有的字段。跳步就会把别的形状误认成文本。

版本差异放在适配器里消化。旧版认 `text`，新版认 `delta.content`，两边都输出同一种「文本增量」。缺了关键字段，报告协议错误。多出来的不认识字段可以忽略，这样模型新增字段时页面不会被弄坏。

`as X` 只让编译器闭嘴。数据是坏的，它什么也不查。网络、磁盘、别的进程来的数据，用守卫。

## 同一种「证明」用在状态上：同一时刻只能有一种形态

守卫证明的是「这份未知数据是不是文本」。状态如果是三个布尔值 `running`、`waiting`、`done`，类型允许它们同时为真。那就不是收窄，而是自相矛盾。

判别联合用一个公共字段区分形态，每种形态只带自己的数据：

```ts
type RunState =
  | { status: 'running'; runId: string }
  | { status: 'waiting'; runId: string; requestId: string }
  | { status: 'completed'; runId: string };
```

`status` 就是判别字段。进了 `'waiting'` 才能读 `requestId`。进了 `'completed'` 就读不到，那种形态里没有这个字段。

转移也按这个字段限制。排队到运行；运行可以完成、失败、取消，也可以进入等待；审批完再回到运行。`Extract<RunState, { status: 'waiting' }>` 只取出等待态，于是 `approve` 在编译期就不接受完成态：

```ts
function approve(
  state: Extract<RunState, { status: 'waiting' }>,
  requestId: string,
): Extract<RunState, { status: 'running' }> {
  if (state.requestId !== requestId) throw new Error('审批已失效');
  return { status: 'running', runId: state.runId };
}
```

函数签名只说明：别的状态传进来，编译失败。调用方如果先读到当前状态再传进来，编译器相信你已经收窄过。来自网络的批准仍要在运行时核对：是不是还在等待，`requestId` 是不是这一次的。类型防的是漏写字段和漏写分支，防不了迟到的事件。

上面的 `approve` 只改状态。它没有把批准发给代理。那个副作用要另写，并且写在状态核对之后。

## 事件也是一种判别联合，通道只负责把它搬过来

页面关心的也是互斥的几件事：来了一段正文、出错了、结束了。SSE 和 WebSocket 只是搬运。通道换了，后面的处理不该重写。所以事件本身不要写死某一种传输。

```ts
type StreamEvent<T> =
  | { type: 'chunk'; runId: string; seq: number; data: T }
  | { type: 'error'; runId: string; message: string }
  | { type: 'done'; runId: string };
```

`T` 就是第一节那个洞，文本和结构化片段都能装。`seq` 用来发现重复或跳号，下一章才展开。

断网可以重连。额度不足要提示用户，并保留已收到的文字。这是两种错误，处理不同，类型上先分开。连接断开只说明通道没了，不说明服务端任务已经停。要停止生成，还得单独发取消。

## Moose 里实际是这样

文件见 [答案](../01-typescript.md)。和上面的讲法比，只记这三条：

- `request` 用方法名约束参数和返回值，IPC 再用 Zod 校验。页面不读某一家 CLI 的原始字段，适配器先收成 `AgentEvent`。
- 会话状态是字符串联合，**没有**完整的类型级状态机。审批是否仍有效，要在运行时核对。
- 文中的 `approve`、`StreamEvent`、`hasText` 是讲法，不是 Moose 源码。
