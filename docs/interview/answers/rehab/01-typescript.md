# 一、类型：把会变的数据说清楚

> 对应答案：[01-typescript.md](../01-typescript.md)，原题 1、2、5、7。

AI 应用里的请求很多，外壳却常常一样。发消息和查用量都是一次请求，参数和返回值完全不同。网上来的 JSON 也不听编译器的：模型一升级，字段可能改名。一次任务还会换形态，排队、执行、等审批、结束，每种形态带的数据不一样。用几个布尔值硬凑，就会出现「已经完成了，却还在等审批」。

TypeScript 能在你写代码时把这些说死。它检查不了网络上真的来了什么。

## 先固定外壳

成功拿数据，失败拿错误。这套处理每种接口都一样，不必重写。

```ts
type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
```

`T` 是类型上留的洞。发消息时填 `{ queueId: string }`，查用量时填 `{ used: number }`。外壳不变，里面的数据变。

这只去掉了重复。函数如果写成 `request(method: string, params: any)`，编译器仍然不知道这次该传 `text` 还是 `provider`。

**补充知识：** 类型标注写在代码里，比如 `text: string`。编译结束以后，这些标注不会留在跑起来的 JavaScript 里。类型写错，程序照样可能跑；类型写对，坏 JSON 也照样能进来。联合类型 `A | B` 表示不是 A 就是 B。泛型参数就是上面那个洞，调用时把具体类型填进去，同一段外壳就能复用。

## 用方法名查出参数和返回值

把「方法名对应什么参数、什么返回值」写成两张表。函数的泛型 `M` 只能是表里的键。传入 `'send'` 之后，参数和返回值就都定了，写错字段会直接报错。

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

`M extends keyof Params` 把方法名限制在表里。`Params[M]` 和 `Outputs[M]` 用这一次的方法名去查。`keyof` 和这种索引都发生在编译期。`request('send', { provider: 'x' })` 会报错，因为 `'send'` 的参数里没有 `provider`。

方法少的时候，每个方法写一个函数更直白。方法有几十个、又要走同一条 IPC 或 HTTP 时，查表让通道只有一个入口，类型仍然按方法名分开。

## 条件类型：从包着的类型里取出里面那层

有时你拿到的是包了一层的类型，想要里面那层。写法是：如果 `T` 长得像某种样子，就用一种结果，否则用另一种。

```ts
type Unwrap<T> = T extends Promise<infer U> ? U : T;

type A = Unwrap<Promise<{ queueId: string }>>; // { queueId: string }
type B = Unwrap<string>;                       // string
```

`infer U` 的意思是：这里有一个当时还不知道的类型，请编译器从匹配到的结构里把它认出来。`Promise<infer U>` 对上了，`U` 就是 Promise 里包着的那个类型。

**补充知识：** 条件类型和泛型都在编译期算完，不会在运行时去拆开一个 Promise。运行时要等它完成，用的是 `await`。

业务代码里更常见的仍是上一节的查表。条件类型用来从已有类型里抽出一层，比如一个辅助类型想说：如果返回值是 Promise，就谈里面的结果，否则就谈它本身。

## 外部数据从 unknown 起步

模型版本一变，JSON 可能从 `{ text }` 变成 `{ delta: { content } }`。你在类型里写得再精确，`JSON.parse` 的结果运行时也不会自动核对。

稳妥的起点是把外部数据看成 `unknown`。编译器会拒绝你直接读 `.text`，直到你证明它真有这个字段。

类型守卫是一个返回 `value is X` 的函数。它返回 `true` 之后，后面的代码才能把这个值当 `X` 用。

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

收窄按这个顺序走。先确认是对象，而且不是 `null`。再用 `type` 或版本字段判断是哪一种格式。然后检查这种格式必有的字段和类型。通过了，才交给页面。跳步就会把别的形状误认成文本。

版本差异放在适配器里消化。旧版认 `text`，新版认 `delta.content`，两边都输出同一种「文本增量」。页面只认这一种。缺了关键字段，应当报告协议错误。多出来的不认识字段可以忽略，这样模型新增字段时页面不会被弄坏。

`as X` 只影响编译器。数据是坏的，编译照样通过，运行时照样用错。类型守卫会在运行时真的检查，失败就不进入那个分支。`as` 只适合你已经用别的办法证明过、编译器却跟不上的时候。网络、磁盘、别的进程来的数据，用守卫。`as` 是让编译器闭嘴，不是检查。

## 状态用判别联合

三个布尔值 `running`、`waiting`、`done`，类型允许它们同时为真。程序里就会出现写得通、业务上不可能的组合。

判别联合用一个公共字段区分形态，每种形态只带自己需要的数据：

```ts
type RunState =
  | { status: 'running'; runId: string }
  | { status: 'waiting'; runId: string; requestId: string }
  | { status: 'completed'; runId: string };
```

`status` 就是判别字段。`switch (state.status)` 进了 `'waiting'`，才能读 `requestId`。进了 `'completed'` 就读不到，那种形态里根本没有这个字段。

合法的转移可以记成：排队到运行；运行可以完成、失败、取消，也可以进入等待；审批完再回到运行。

类型还能限制谁可以调用这个函数。`Extract<RunState, { status: 'waiting' }>` 从联合里只取出等待态，于是 `approve` 在编译期就不接受完成态：

```ts
function approve(
  state: Extract<RunState, { status: 'waiting' }>,
  requestId: string,
): Extract<RunState, { status: 'running' }> {
  if (state.requestId !== requestId) throw new Error('审批已失效');
  return { status: 'running', runId: state.runId };
}
```

函数签名只说明一件事：调用方如果把别的状态传进来，编译失败。调用方如果先读到当前状态再传进来，编译器相信你已经收窄过。来自网络的批准仍然要在运行时核对：当前是不是还在等待，`requestId` 是不是这一次的。类型防的是漏写字段和漏写分支，防不了迟到的事件。

上面的 `approve` 只演示状态怎么变。它没有把批准发给代理。那个副作用要另写，并且写在你确认状态合法之后。

## 流式事件和通道是两件事

页面真正关心三件事：来了一段正文、出错了、结束了。SSE 和 WebSocket 只是把这些事件搬过来的通道。通道换了，后面的处理不该重写。

```ts
type StreamEvent<T> =
  | { type: 'chunk'; runId: string; seq: number; data: T }
  | { type: 'error'; runId: string; message: string }
  | { type: 'done'; runId: string };
```

`T` 让同一套事件既能装文本，也能装结构化片段。`seq` 用来发现重复或跳号，下一章会展开。

传输错误和业务错误要分开。断网、连接被关掉，可以按规则重连、补拉。额度不足、模型拒绝，要提示用户，并保留已收到的内容。

连接断开，只说明通道没了，不说明服务端任务已经停。要停止生成，需要单独发取消请求。类型上先把 `error` 和「连接没了」留成不同的情况，后面才拆得开。

## Moose 里实际是这样

文件和字段见 [答案](../01-typescript.md)。和上面的示例比，只记这三条：

- `request` 用方法名约束参数和返回值，IPC 再用 Zod 校验。页面不读某一家 CLI 的原始字段，适配器先收成 `AgentEvent`。
- 会话状态是字符串联合，**没有**完整的类型级状态机。审批是否仍有效，要在运行时核对。
- 文中的 `approve`、`StreamEvent`、`hasText` 是讲法，不是 Moose 源码。

## 合上之后能说的几句

接口外壳固定，变化的参数和返回值用方法名去查，写错字段时编译器能拦住。条件类型负责从类型里抽出里面那一层，比如把 Promise 包着的类型拿出来。这些都只在编译期发生。

网络和 CLI 来的数据先当 `unknown`，用类型守卫逐项证明，再收成页面统一的形状。缺关键字段报协议错误，多出来的字段可以忽略。`as` 只是让编译器闭嘴。

任务状态用判别联合，一种形态一份数据。切换函数只接受合法的那一种。运行时仍要核对当前状态和任务 ID。流式先定义与通道无关的事件：片段、错误、结束。断线和模型报错分开，断开连接也不等于任务已取消。

可以自己讲这三句：为什么 `request('send', …)` 能推出返回类型？守卫比 `as` 多做了哪一步？完成态为什么不该带 `requestId`？
