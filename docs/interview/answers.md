# 前端与 AI 应用面试参考答案

配合[题目](questions.md)使用。共 145 题，保留原题号，按原练习范围回答其中 138 题。项目介绍与完整调用链统一见[项目面试指南](project-interview-guide.md)，本文侧重通用知识与设计题。

教学代码不等于 Moose 源码，设计方案不等于已经完成的项目经历。涉及 Moose 的示例用于说明具体机制，支持范围以[能力表](../providers/native-capabilities.md)为准；没有测量证据的性能数字不作为项目成果。

未作答的题目为二-10、三-3、三-6、三-9、四-7、六-2、八-3。混合选项题按原练习范围主要讲 Zustand、Sentry 基础和 Vite；不展开 Redux、XState、不可变／原子状态库、AI 语音、指定推理库及 AI 链框架。

### 复习导航

- [一、TypeScript 与类型系统](#part-1)
- [二、流式处理与实时通信](#part-2)
- [三、前端状态管理与数据流](#part-3)
- [四、性能优化与渲染](#part-4)
- [五、前端 AI 架构设计](#part-5)
- [六、AI 特性与前端工程实践](#part-6)
- [七、AI 工程化与前端工具链](#part-7)
- [八、大模型前端集成](#part-8)
- [场景题](#part-9)

### Moose 的案例主线

| 场景             | 已有机制                                         | 不要混淆成                    |
| ---------------- | ------------------------------------------------ | ----------------------------- |
| 一次生成多条记录 | runId 关联，event.key 区分片段，seq 防旧版本覆盖 | 任意 delta 全局去重           |
| 同目录多个任务   | 目录互斥、持久化队列                             | 优先级抢占或分布式锁          |
| 长回答展示       | 80ms 合并、80 条分页、memo、content-visibility   | 已实现增量 AST 或完整虚拟列表 |
| 恢复会话         | SQLite、nativeId、中断状态修正                   | 离线生成、自动重放所有任务    |
| 编辑最新用户消息 | 原生 fork 或 historySeed，替换最新轮次           | 任意历史分支合并、回滚文件    |
| 多代理接入       | 统一 AgentAdapter，保留能力差异                  | 已有第三方插件市场            |
| 用量展示         | 上下文与套餐额度，缓存/并发合并                  | 单次模型费用账单、生成进度    |

下面每道保留题都包含完整原题，重复主题也保留独立答案，不要求来回跳转。

<a id="part-1"></a>

## 一、TypeScript与类型系统

### 1. 在定义AI接口返回的嵌套数据结构（如多轮对话、工具调用结果）时，如何用TypeScript的泛型与条件类型实现灵活的类型推导？

**可以这样答：** 先把稳定的业务结构定义清楚，再用泛型表达“外壳相同、内容不同”，用条件类型表达“输入不同，结果类型也不同”。不要为了展示类型技巧，把整个接口写成难维护的递归类型。

```ts
type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
type ToolResult<T> = { callId: string; result: Result<T> };
type DataOf<T> = T extends { ok: true; data: infer D } ? D : never;
type SearchResult = ToolResult<{ hits: { title: string; url: string }[] }>;
```

`Result<T>` 复用成功/失败结构；`DataOf<T>` 从成功分支提取实际数据。外部 JSON 仍需运行时校验，TS 类型编译后就不存在了。

**Moose 实例：** `MooseAPI.request<M extends Method>(method: M, params: Requests[M]): Promise<Responses[M]>` 把方法名、参数、返回值对应起来。调用 `messages` 时必须传 `sessionId`，返回值自动是 `TranscriptPage`。这比给所有接口都返回 `any` 更有用。见 [共享类型](../../shared/types.ts)。条件类型规则参考 [TypeScript 官方说明](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html)。

### 2. 当AI接口返回的字段可能因模型版本不同而动态变化时，如何设计类型守卫（type guard）与类型收缩策略？

**可以这样答：** 接口入口用 `unknown`，先确认是对象，再按版本或 `type` 字段分支校验，最后转换成前端统一的数据模型。可选字段要有降级逻辑，不能用 `as` 假装数据正确。

```ts
function isTextChunk(x: unknown): x is { type: 'text'; delta: string } {
  return (
    typeof x === 'object' &&
    x !== null &&
    'type' in x &&
    x.type === 'text' &&
    'delta' in x &&
    typeof x.delta === 'string'
  );
}
```

例如 v1 返回 `text`、v2 返回 `delta.content`，在适配器里分别识别，然后都转换成 `{ kind: 'assistant', delta }`。关键字段缺失就报协议错误；新增但不影响处理的字段可以忽略，不能把异常全部吞成空字符串。

**Moose 实例：** IPC 输入由 [Zod 白名单](../../shared/validation.ts) 校验；代理侧通过 [适配器辅助函数](../../electron/providers/types.ts) 处理 `unknown`。两者严格程度不同：`record/string/array` 是容错提取，不等于完整协议 Schema 校验。

### 3. 请用TypeScript实现一个“类型安全的Prompt模板解析器”，要求支持变量插值、类型校验与默认值。

**可以这样答：** 我会把模板变量和变量 Schema 绑定。编译时检查变量名与取值类型，运行时检查从表单或 JSON 来的数据；默认值只有在变量缺省时才生效。

下面是**教学实现**，语法只支持 `{{name}}`，不支持表达式、嵌套和转义：

```ts
type Names<S extends string> = S extends `${string}{{${infer K}}}${infer Rest}`
  ? K | Names<Rest>
  : never;
type Field<T> = { parse(x: unknown): T };
type Values<S> = { [K in keyof S]: S[K] extends Field<infer T> ? T : never };

function prompt<const T extends string, S extends Record<Names<T>, Field<unknown>>>(
  template: T,
  schema: S,
) {
  return (values: Values<S>) =>
    template.replace(/\{\{([^{}]+)\}\}/g, (_, key: string) => {
      if (!Object.hasOwn(schema, key)) throw new Error(`未知变量：${key}`);
      const field = schema[key as keyof S] as Field<unknown>;
      return String(field.parse(values[key as keyof S]));
    });
}
const nonempty: Field<string> = {
  parse(x) {
    if (typeof x !== 'string' || !x.trim()) throw new Error('topic 必须是非空字符串');
    return x;
  },
};
const count: Field<number | undefined> = {
  parse(x) {
    if (x === undefined) return 3;
    if (typeof x !== 'number' || !Number.isInteger(x) || x < 1)
      throw new Error('count 必须是正整数');
    return x;
  },
};
const render = prompt('请列出 {{topic}} 的 {{count}} 个要点', { topic: nonempty, count });
render({ topic: 'React', count: undefined }); // 默认 3
// render({ topic: 'React', count: '三' }); // 编译报错
```

这个简化版用显式 `undefined` 触发默认值；生产版可把带默认值的字段映射成可选属性，并用成熟 Schema 库处理错误。动态加载的模板无法凭空获得编译期变量名，必须运行时解析和验证。变量插值也不能防止 Prompt 注入，用户内容和可信指令仍要分开。Moose 的 `PromptContext` 管模式与引用，**没有这套模板引擎**。

### 4. 如何用TypeScript的模板字面量类型（Template Literal Types）约束AI返回的特定格式字符串（如日期、ID）？

**可以这样答：** 模板字面量类型适合约束字符串的外形，例如要求 ID 以 `run_` 开头。但“长得像日期”不代表“真的是合法日期”。

```ts
type RunId = `run_${string}`;
type DateShape = `${number}-${number}-${number}`;
const id: RunId = 'run_123';
const date: DateShape = '2026-99-99'; // 类型允许，但日期非法
```

真正的日期还要检查位数、月份范围、闰年和日期有效性；ID 若要求 UUID，也应使用运行时 UUID 校验。对已经验证的字符串可以再加品牌类型，限制普通字符串被直接当成合法 ID。

**Moose 实例：** 共享类型中 ID 大多是 `string`，IPC 在运行时使用 `z.string().uuid()` 校验。不要说项目已经给所有 ID 做了品牌类型。语法参考 [模板字面量类型](https://www.typescriptlang.org/docs/handbook/2/template-literal-types.html)。

### 5. 设计一个类型系统，用于描述AI Agent执行过程中的状态流转（如思考→执行→观察→完成），并实现类型安全的状态切换。

**可以这样答：** 用带判别字段的联合类型描述不同状态的数据，再限制允许出现的“旧状态、新状态”组合。只写 `status: string` 防不住非法跳转。

```ts
type State =
  | { tag: 'thinking' }
  | { tag: 'executing'; callId: string }
  | { tag: 'observing'; result: string }
  | { tag: 'done'; answer: string };
type LegalTransition =
  | [Extract<State, { tag: 'thinking' }>, Extract<State, { tag: 'executing' | 'done' }>]
  | [Extract<State, { tag: 'executing' }>, Extract<State, { tag: 'observing' }>]
  | [Extract<State, { tag: 'observing' }>, Extract<State, { tag: 'thinking' | 'done' }>];
function transition(...[from, to]: LegalTransition): State {
  void from;
  return to;
}
```

这段代码演示编译期的合法组合；生产中由统一 reducer 执行事件，并检查运行时当前状态和 `runId`，否则旧任务的完成事件仍可能污染新任务。失败、取消也需要明确的转移规则。

**Moose 实例：** 已定义 `Status` 联合，包含 `running/waiting/interrupted` 等，Service 按业务条件切换；审批答复还检查任务存在、消息为 pending、任务未取消。当前并不是上述完整的类型级状态机。见 [类型](../../shared/types.ts)、[服务](../../electron/service.ts)。

### 6. 在联合类型（Union Types）与交叉类型（Intersection Types）中，哪种更适合定义多模态AI输出（文本、图像、音频）？为什么？

**可以这样答：** 不同输出形态用判别联合更合适，共有字段用交叉类型补进去。联合是“其中一种”，交叉是“同时满足”。

```ts
type Output = { id: string } & (
  { kind: 'text'; text: string } | { kind: 'image'; url: string; width: number; height: number }
);
```

判断 `kind === 'image'` 后就能安全读取宽高，不需要把所有字段都声明为可选。如果一条消息确实同时有文字和图片，就用 `parts: Output[]` 表示多个片段，而不是要求每个片段同时包含所有类型的字段。本题按要求不展开音频。

**Moose 实例：** `Message.kind` 区分文本、工具、审批等记录，但目前 `choices/questions` 等是可选字段；可作为改进方向进一步拆成判别联合，不能说源码已经这样做了。

### 7. 如何用TypeScript声明一个支持流式Chunk数据与错误处理的泛型接口，并兼容SSE、WebSocket等多种传输方式？

**可以这样答：** 把业务事件与传输方式分开：业务消费统一的异步事件流，SSE 和 WebSocket 只负责把原始帧解码成事件。

```ts
type StreamEvent<T> =
  | { type: 'chunk'; runId: string; seq: number; data: T }
  | { type: 'error'; code: string; message: string; retryable: boolean }
  | { type: 'done'; reason: 'complete' | 'cancelled' };
interface Transport<T> {
  connect(input: {
    runId: string;
    after?: number;
    signal: AbortSignal;
  }): AsyncIterable<StreamEvent<T>>;
  cancel(runId: string): Promise<void>;
}
```

统一约定序号范围、完成事件、异常是否终止流。断网可表现为抛出的传输异常，模型拒绝可以是业务事件；不要既回调错误又抛错，导致 UI 提示两次。断开读取与取消服务端任务是两件事。

**Moose 实例：** [AgentAdapter](../../electron/providers/types.ts) 使用 `emit(AgentEvent)`，将各底座协议转换后交给 Service。CLI 侧主要使用 stdio；Web 和共享桌面连接业务服务时使用 HTTP／SSE，不能混淆这两段传输。

### 8. 当AI服务返回的数据结构包含递归引用（如对话树）时，如何用TypeScript定义并避免循环引用导致的类型爆炸？

**可以这样答：** 普通递归结构可以直接定义 `children: Node[]`，真正容易“类型爆炸”的是无限展开的条件类型和映射类型。业务数据很深时，优先用 ID 引用的规范化结构。

```ts
interface TurnNode {
  id: string;
  parentId: string | null;
  children: string[];
  text: string;
}
type ConversationTree = Record<string, TurnNode>;
```

这样查节点是按 ID 查表，序列化不会因对象互相引用而报错。遍历仍要加 `visited` 防环；显示按需展开，限制深度和节点数。确实需要递归类型运算时，加深度计数与终止条件，不对整个服务协议做无限 `DeepXxx`。

**Moose 实例：** 项目、会话、消息通过 ID 关联，消息排序用 `position`；目前不是任意分叉的对话树。

### 9. 请设计一个类型系统，用于前端对AI模型元数据（版本、输入输出格式、最大Token数）的静态校验。

**可以这样答：** 静态配置用字面量联合和 `satisfies` 检查字段，动态模型列表用运行时 Schema 校验。两者不能互相替代。

```ts
type ModelMeta = {
  version: string;
  input: readonly ('text' | 'image')[];
  output: readonly ('text' | 'image')[];
  contextWindow: number;
  maxOutputTokens: number;
};
const models = {
  demo: {
    version: 'v1',
    input: ['text'],
    output: ['text'],
    contextWindow: 8192,
    maxOutputTokens: 1024,
  },
} as const satisfies Record<string, ModelMeta>;
```

数字是**示例配置**。TS 的 `number` 不会保证正整数或输出上限小于窗口，仍需启动校验。还要区分上下文容量、输出上限和账号额度，不能混为一谈。

**Moose 实例：** `ProviderInfo` 包含能力、模型与权限模式，`ContextUsage` 单独描述上下文，`UsageInfo.limits` 描述额度。源码没有完整静态模型容量表，而是由代理信息驱动。

### 10. 如何用TypeScript的infer关键字提取AI流式响应中的嵌套数据字段（如choices[0].delta.content）？

**可以这样答：** 用条件类型匹配结构，在目标字段位置写 `infer`。流式内容经常缺省，结果类型应保留 `undefined`。

```ts
type ContentOf<T> = T extends {
  choices: readonly { delta: { content?: infer C } }[];
}
  ? C | undefined
  : never;
type Content = ContentOf<{ choices: { delta: { content?: string } }[] }>;
// string | undefined
```

这是提取类型，不是读取运行时值。读取仍然用 `data.choices[0]?.delta.content`，并提前校验外部数据；空数组、工具调用事件、结束事件都可能没有文本。Moose 会在 provider 层转换协议，不让 UI 到处访问服务商的嵌套路径。

<a id="part-2"></a>

## 二、流式处理与实时通信

### 1. 请设计一个支持“断线重连+消息去重”的SSE客户端，并处理AI长文本生成中的网络抖动问题。

**可以这样答：** 重连要解决两件事：服务端从哪里继续发，客户端如何避免重复消费。协议应给每次生成 `runId`，给事件连续递增的序号或可恢复的事件 ID；客户端保存最后成功应用的游标。

原生 `EventSource` 有自动重连机制，服务端发送 `id:` 后浏览器可在重连时携带 `Last-Event-ID`。但服务端必须保存并支持补发；没有补发能力，前端重连只能重新建立连接，不能保证接上原文。用 fetch 读取 POST 流时，需要自己管理退避、游标和取消。参考 [SSE 事件格式与重连](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)。

设计时可按以下规则处理：

1. `seq <= lastSeq` 丢弃；`seq === lastSeq + 1` 应用并更新游标；更大的序号先缓存并请求缺口。
2. 异常重连采用指数退避加随机抖动，设置次数/时间上限；鉴权错误先恢复登录。
3. 切换会话或主动停止时取消连接，完成后不再重连。
4. 已收到的文本保留，UI 显示“连接中断”；不能用新请求悄悄重复执行有副作用的工具。

**Moose 实例：** `mergeMessages` 按 ID 和 `seq` 防止旧版本覆盖新记录；这些是完整消息快照，不要求每个版本都到达。CLI 的重复 `delta` 若被重复接受，仍可能被追加两次。这个区别是本题最有价值的追问。见 [workspace](../../src/lib/workspace.ts)、[accept/flush](../../electron/service.ts)。

### 2. 如何在前端实现一个“流式Markdown解析器”，在AI逐字输出过程中实时渲染标题、列表、代码块，并避免标签截断？

**可以这样答：** 不要把每个网络 Chunk 单独当成完整 Markdown。先合并原文，再解析展示；否则一个代码围栏或链接被拆成两半就会闪烁、误解析。

简单方案是累积全文，按帧或几十毫秒批量刷新，用能容忍未完成输入的 Markdown 解析器。长文再升级为“已稳定块缓存 + 尾部重新解析”：完整段落、代码块可以缓存，但引用式链接等后续语法可能影响前文，需要明确语法子集或做依赖失效。未闭合代码块可临时按代码展示，生成结束后对全文做最终解析。

**Moose 实例：** Service 先累计文本，约每 80ms 刷新；`Transcript` 用 `react-markdown + remark-gfm + rehype-highlight` 展示当前全文，跳过 HTML。它**没有增量 AST 解析器**，更新中的大文本仍可能重复解析和高亮；已完成消息通过 `memo` 减少无关重渲染。见 [时间线](../../src/components/transcript.tsx)。

### 3. 当AI流式返回的数据包含多个独立片段（如文本、代码、表格）时，如何设计Chunk合并算法以保证片段完整性？

**可以这样答：** 先明确片段的身份，不能只维护一个全局字符串。每个事件至少包含 `runId、partId、type、seq、delta`，文本、代码、表格分别累计；用 `partIndex` 或首次出现位置决定显示顺序。

同一片段按序追加，重复序号丢弃；缺号先缓冲或请求补发，完成事件到来后再将片段标记为完整。若上游发的是完整快照，则只比较版本并替换，不重复 append。表格行、工具参数 JSON 等结构未闭合时先缓存，不能把不完整 JSON 当成执行参数。

**Moose 实例：** 消息 ID 使用 `runId + event.key`；`event.text` 替换已有文本，`event.delta` 追加；不同工具记录与文本记录不会混到同一条中。落库产生 `position`，供分页和排序。复制整轮回答时按 `runId` 查询所有 assistant 文本，不依赖当前已加载的页面。见 [服务](../../electron/service.ts)、[Store](../../electron/db/store.ts)。

### 4. 请实现一个支持“优先级调度”的流式请求队列，允许用户中断低优先级生成（如翻译）以优先处理高优先级任务（如代码生成）。

**可以这样答：** 队列要同时管理优先级、并发资源和取消完成。只把高优先级项插到数组前面，不能抢占已经在运行的任务。

一个最小调度流程是：

```text
enqueue(job): 保存 priority、createdAt、resourceKey，进入等待队列
pump(): 从资源可用的任务中选 priority 最大、入队最早的任务启动
preempt(high): 标记低优先级任务取消 → 请求远端停止 → 等资源释放 → 启动 high
finally: 释放资源占用 → 再次 pump()
```

下面是**单执行槽的教学实现**，数值越大优先级越高。`run` 负责把取消信号传到真实请求/远端取消接口，且必须在资源真正释放后才结束 Promise：

```ts
type Job = { id: string; priority: number; run(signal: AbortSignal): Promise<void> };
class PriorityQueue {
  private queue: (Job & { order: number })[] = [];
  private order = 0;
  private active?: { job: Job; controller: AbortController };

  enqueue(job: Job, preempt = false) {
    if (this.active?.job.id === job.id || this.queue.some((x) => x.id === job.id)) {
      throw new Error('重复任务 ID');
    }
    this.queue.push({ ...job, order: this.order++ });
    this.queue.sort((a, b) => b.priority - a.priority || a.order - b.order);
    if (preempt && this.active && this.active.job.priority < job.priority) {
      this.active.controller.abort();
    }
    void this.pump();
  }

  cancel(id: string) {
    this.queue = this.queue.filter((job) => job.id !== id);
    if (this.active?.job.id === id) this.active.controller.abort();
  }

  private async pump(): Promise<void> {
    if (this.active) return;
    const job = this.queue.shift();
    if (!job) return;
    const controller = new AbortController();
    this.active = { job, controller };
    try {
      await job.run(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) console.error('任务失败', job.id, error);
    } finally {
      this.active = undefined;
      void this.pump();
    }
  }
}
```

示例不会在发出 abort 的瞬间释放执行槽：如果底层忽略取消，后面的任务仍需等待，这比让两个写任务重叠更安全。生产中要增加远端确认/进程终止策略，不能只用超时拒绝 Promise 假装资源已经释放。

生产中增加任务 ID、AbortController、远端取消接口、取消超时和优先级老化，防止低优先级任务永远饿死。中断文本生成可以保留部分结果；正在改文件的任务不能假定取消就等于回滚。取消失败时不要让两个写任务同时占用同一资源。

**Moose 实例：** 当前按会话实际工作目录串行，同目录只允许一个 active 代理任务，不同目录或 worktree 可并行；队列按时间处理，**没有优先级抢占**。`stop` 会暂停该会话后续队列并关闭 adapter。扩展优先级时应保留目录互斥规则。清理代码虽写在 `finally`，仍需保证 `adapter.close()` 抛错不会跳过锁释放；“用了 finally”本身不是充分保证。见 [Service](../../electron/service.ts)。

### 5. 在React 18+中，如何用useTransition与useDeferredValue优化AI流式输出的渲染性能，避免主线程阻塞？

**可以这样答：** 输入框、停止按钮属于紧急更新；大段回答渲染可以延后。`useTransition` 用来标记非紧急状态更新，`useDeferredValue` 让昂贵子树暂时使用旧值。

```tsx
const deferredText = useDeferredValue(text);
return (
  <>
    <input value={input} onChange={(e) => setInput(e.target.value)} />
    <MemoizedAnswer text={deferredText} />
  </>
);
```

两者都不会把 JS 搬到后台线程，也不会减少请求次数。一个同步运行 200ms 的解析函数不会因为包进 transition 就自动可中断；要先拆小、缓存或移入 Worker。`useTransition` 也不该控制输入框本身的值。参考 [useTransition](https://react.dev/reference/react/useTransition)、[useDeferredValue](https://react.dev/reference/react/useDeferredValue)。

**Moose 实例：** 当前重点是 80ms 批量发布、消息级 `memo`、历史分页、独立后台进程；源码没有使用这两个 Hook，面试可说“进一步优化方向”，不能说已经落地。

### 6. 设计一个“流式数据缓存”策略，将AI已生成的内容分段存储于IndexedDB，支持离线续写与历史回放。

**可以这样答：** 按 `conversationId/runId/partId` 分段存储正文、序号和状态；内存里实时更新，按时间或大小批量写 IndexedDB，用事务同时保存片段和最后提交游标。

恢复时先加载本地片段，再根据服务端游标补齐；回放按序号或相对时间重放，倍速播放时批量更新。做 Schema 版本迁移、容量上限、旧会话清理和 quota 错误处理。不要每个 token 都开启一次事务。

“离线续写”需要分清：离线可以继续编辑草稿、回看历史；没有本地模型就不能继续生成。联网后续生成也需要服务端任务/上下文仍可恢复。

**Moose 实例：** 用 SQLite 而非 IndexedDB。队列先持久化，文本约 80ms 刷新；重启把未完成状态标记为 interrupted/expired 并暂停队列，不自动重复执行。异常退出可能丢掉最后尚未 flush 的一小段内容，不能声称每个 token 都持久化了。见 [Store](../../electron/db/store.ts)。

### 7. 如何用Web Worker并行处理多个AI流式响应（如同时生成文本与摘要），并实现跨线程状态同步？

**可以这样答：** Worker 用来搬走解析、分词、摘要后处理等 CPU 工作；多个 fetch 本来就能并发，不需要为了“同时请求”专门开 Worker。

主线程发送 `{ taskId, generation, type, payload }`，Worker 返回增量结果与版本；UI 丢弃已取消或过期任务的返回。大 ArrayBuffer 用 transferable 降低拷贝成本，文本按批次发送，给待处理队列设置上限和暂停/取消协议。Worker 无法直接操作 DOM，最终展示仍在主线程。

**Moose 实例：** 重业务放到独立后台；安装版通过 HTTP／SSE 连接共享服务，默认开发模式使用 Electron utility process。它和 Web Worker 都体现“重计算离开界面线程”，但进程隔离、Node 能力、崩溃边界不同，不能混称。

### 8. 当AI服务端返回的流式数据包含自定义事件（如[DONE]、[ERROR]）时，前端如何解析并触发相应回调？

**可以这样答：** 先按 SSE 协议组成完整事件，再识别业务标记。网络读取边界不等于事件边界，甚至 UTF-8 字符也可能跨两次读取。

fetch 流可用 `TextDecoder` 的流式解码；保留未完成行，兼容换行格式，空行表示事件结束，多行 `data:` 用换行连接，`:` 开头注释忽略。完整 `data` 恰好为 `[DONE]` 才结束；`[ERROR]` 的格式由业务协议定义，普通正文里出现这些字样不应误判。命名事件则用 `addEventListener('事件名', handler)` 接收。

解析错误、网络错误和模型错误分开处理；完成/取消只结算一次，清理 reader、监听和重连定时器。参考 [SSE 格式](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)。

**Moose 实例：** JSON-RPC stdio 也有拆包问题。[rpc.ts](../../electron/providers/rpc.ts) 保存 buffer，按完整行解析 JSON，并限制协议缓存大小。它没有处理 SSE 标记，但解决的“传输分块不等于消息”问题相同。

### 9. 请设计一个“流式进度估算”组件，根据已接收的Token数与模型速率，动态预测AI生成剩余时间。

**可以这样答：** 生成之前通常不知道最终 token 数，所以不能给准确百分比。`max_tokens` 是上限，不是预计一定生成这么多。

有可靠任务总量时可显示完成比例；没有时显示“正在生成、已生成数量、最近速率”。速率用滑动窗口或指数平滑：`rate = 最近新增 token / 时间`；只有存在可信的预计总量时，才用 `剩余数量 / rate` 给粗略时间范围。首 token 等待、工具执行、用户审批要单独展示，不用零速率算出无穷大。

**Moose 实例：** 当前展示 running/waiting 和上下文占用；上下文百分比是“窗口用了多少”，不是“回答完成多少”。`ContextUsage.capacity` 可以为 null，未知就显示未知。没有真实 tokenizer/服务端统计时，字符数不能直接冒充 token 数。

<a id="part-3"></a>

## 三、前端状态管理与数据流

### 1. 在大型AI应用中，如何用Zustand或Redux Toolkit管理多轮对话、生成任务、用户配置等复杂状态？

**可以这样答：** 按题意这里只讲 Zustand。我会把服务端数据、任务状态、用户设置、临时 UI 状态分开，不把每个输入字符和所有消息都塞进一个全局对象。

对话存 `messagesById + orderedIds`，任务存 `tasksById`，组件通过 selector 只订阅需要的记录；修改一条消息只替换该对象并保留其他引用。派生值尽量计算而不重复存储，动作集中在 store，网络回调通过明确动作写入，避免组件随意改业务状态。订阅整个 store 或每次 selector 都创建新对象，仍可能导致大面积更新。

**Moose 实例：** 当前没有 Zustand：`useWorkspace` 管快照，`useTranscript` 管消息，组件 Hook 管弹层和输入等局部状态。`mergeMessages` 保留未变消息对象，是局部更新的重要基础。以后若跨组件共享越来越复杂，再评估引入 store。见 [workspace](../../src/lib/workspace.ts)。

### 2. 设计一个“状态快照”系统，支持将AI对话的完整状态（包括流式中间结果）序列化保存与恢复。

**可以这样答：** 快照要保存可恢复的业务事实，而不是把内存对象原样 JSON 化。至少包括 Schema 版本、会话与模型配置、消息内容与版本、待发送队列、最后确认游标、生成状态。

Promise、函数、连接和 AbortController 不可恢复，重载后重建。保存过程中用事务或一致性版本避免“消息保存了、游标没保存”；恢复时先迁移、校验，再将运行中任务标为中断，由用户决定是否续接。不同 provider 的 nativeId 必须带来源，不能互换。

**Moose 实例：** `Snapshot` 只含项目、会话、设置和外观，并不是包含所有消息的完整快照。消息单独分页存 SQLite；Store 启动时修正遗留状态，Service 暂停保留的队列。可以说“采用持久化数据恢复”，不能说“序列化 Snapshot 就能无损恢复运行中的进程”。

### 4. 在微前端架构下，多个AI功能模块需要共享“当前模型版本”状态，如何设计跨应用状态同步方案？

**可以这样答：** 让宿主维护当前模型的唯一真值，子应用通过受控接口订阅和发起更新，而不是每个应用各放一个互不相干的 store。

状态包含 `{ modelId, revision }`，订阅时先获取快照，再接收新版本；更新要校验模型能力和权限。处理卸载取消订阅、消息来源校验、循环广播和版本冲突。不同窗口可用 BroadcastChannel，同页面可用宿主事件总线，远端设备同步仍需要服务端。

**Moose 类比：** 设置由后台存储，Renderer 请求快照并订阅变化。它不是微前端，但可借此解释“业务状态集中管理，UI 是投影”。全局默认模型与每个会话实际模型也应分开，切换默认值不能悄悄改变正在运行的任务。

### 5. 请设计一个“乐观更新”策略，在用户发送AI请求后立即在UI中显示预期结果，再根据实际流式响应逐步修正。

**可以这样答：** 乐观更新应该先展示“用户已提交”和“AI 正在处理”，不要凭空伪造 AI 已生成的内容。用户消息分配 `clientMessageId`，先标记 sending；服务端确认后改为 accepted，再展示真实增量。

失败时保留用户输入并提供重试，重试沿用业务幂等键，防止重复生成。旧会话响应按 `sessionId/runId` 归位；编辑后旧请求返回必须丢弃。列表项 key 尽量在确认前后稳定，避免组件被重建。

**Moose 实例：** `send` 先持久化队列并返回 QueueItem，任务启动时才在事务里建立用户消息；这更接近“排队状态即时反馈”，不是服务端确认前就插入正式用户消息的完整乐观更新方案。见 [send/begin](../../electron/service.ts)、[Store](../../electron/db/store.ts)。

### 7. 设计一个“状态版本控制”系统，支持AI对话历史的任意回退、分支创建与合并（类似Git）。

**可以这样答：** 对话版本可以建成 DAG：每个节点保存父节点、消息和配置，分支只是指向某个节点的指针；切换分支改变当前路径。长期历史可以事件日志加周期快照，避免每次复制整棵树。

对话合并没有通用的文本三路合并答案：两条分支可能代表相互矛盾的事实或不同工具副作用。应让用户选择保留内容，再生成一个新的合并节点，记录来源。工具已经改过文件，回退对话不能自动当成回滚文件。

**Moose 实例：** 只允许编辑空闲会话的最新用户消息。可用时通过原生 fork 准备前文上下文，否则生成 historySeed；事务替换最后一轮并发出 `transcript-reset`。编辑本身不创建侧栏分支；另有 Codex 显式分叉入口，但没有任意历史回退／合并系统。见 [replaceMessage](../../electron/service.ts)。

### 8. 在离线优先的AI应用中，如何用RxJS或@tanstack/query管理本地缓存与网络状态的同步？

**可以这样答：** 我会选 TanStack Query 管服务端缓存、失效和重试，本地草稿另存 IndexedDB。Query 缓存不是持久化数据库，持久化和离线写入队列要单独配置。

网络模式决定离线时任务是暂停还是允许尝试；恢复网络后根据实际请求结果更新状态。`navigator.onLine` 只是提示，不能证明 API 可达。离线 mutation 记录幂等键、操作类型、版本，恢复时按顺序提交；版本冲突提示用户合并。持久化后恢复 mutation 还需要可重新构造的执行函数。参考 [TanStack Query 网络模式](https://tanstack.com/query/latest/docs/framework/react/guides/network-mode)。

**Moose 实例：** 本地 SQLite 可以离线查看历史，但代理服务不可达时仍不能生成。源码没有 Query/RxJS；已有磁盘队列可类比“先保存意图，再执行”，不过它不是网页离线同步协议。

### 10. 设计一个“状态持久化”方案，将AI应用的关键状态自动保存至IndexedDB，并支持跨标签页同步。

**可以这样答：** 用 IndexedDB 保存业务状态和版本，BroadcastChannel 只通知其他标签页“哪些实体发生了变化”，收到通知后读取数据库。广播不是持久化，关闭的标签页不会补收历史消息。

写入用事务，消息带 `originId/entityId/revision`，避免自己收到后再次广播；冲突使用版本比较或由单一写入者仲裁。localStorage 只放少量偏好，不承担高频长文本存储。升级数据库时处理旧标签页阻塞和 `versionchange` 关闭连接。

**Moose 实例：** SQLite 是主数据源，桌面经 IPC、Web 经 HTTP／SSE 访问同一业务服务；少量展示偏好使用 localStorage。共享状态由服务持有，不使用 IndexedDB 跨标签页同步。

<a id="part-4"></a>

## 四、性能优化与渲染

### 1. 在万条级别的AI对话历史中，如何实现毫秒级搜索与过滤（关键词、时间范围、模型类型）？

**可以这样答：** 万条数据不应每输入一个字就扫描、解析所有长文本。先确认搜索范围：会话标题、正文全文、时间和模型过滤，适合的索引不同。

标题数据少可以预先标准化字符串再本地过滤；全文搜索用倒排索引或数据库全文索引，时间/模型用普通索引先缩小候选。输入防抖、过期查询取消、结果分页；中文分词、前缀匹配、索引增量更新都要提前定义。延迟用真实数据量与设备测量 p50/p95，不能先承诺“毫秒级”。

**Moose 实例：** 当前在内存过滤会话标题和项目名，展示前 100 条；不是聊天正文全文检索。以后可在 SQLite 中增加 FTS 与过滤索引，但当前源码未实现。见 [app.tsx](../../src/app.tsx)。

### 2. 请设计一个“虚拟化渲染”方案，用于超长AI生成内容（如数万Token的文档）的平滑滚动与快速定位。

**可以这样答：** 先分清“很多条消息”和“一条特别长的消息”。前者按消息虚拟化，后者还要按 Markdown 块切分，否则只挂载一条消息也可能产生上万 DOM。

虚拟列表保留可见区加 overscan，外部用占位高度维持滚动长度；动态高度用 ResizeObserver 测量缓存。定位到某段时先估算位置再修正，顶部插入旧数据时保住阅读锚点。代码块可按行分段，但不能为了分段破坏语法结构。搜索、浏览器查找、复制和无障碍需要补充处理，因为未挂载内容不在 DOM 里。

**Moose 实例：** 每页 80 条历史，消息容器用 `content-visibility: auto` 和估计高度，减轻屏外布局绘制；DOM/React 元素并未因此完整卸载，不能宣称是完整窗口化虚拟列表。见 [滚动组件](../../src/components/ui/message-scroller.tsx)、[Store](../../electron/db/store.ts)。

### 3. 如何用WebGL或Canvas实现AI生成图像的高性能实时预览（如缩放、拖拽、滤镜）？

**可以这样答：** 普通图片缩放拖动优先用 CSS transform，只有大量滤镜或像素计算时再上 Canvas/WebGL。Canvas 适合二维绘制，WebGL 可以让 GPU 并行处理滤镜。

原始图片只解码一次，交互时更新变换矩阵并在 requestAnimationFrame 合并重绘；限制像素尺寸和 DPR，避免超大纹理爆内存。加载新图片时释放旧 bitmap/纹理，对上下文丢失和低性能设备降级。跨域图片若要导出 Canvas，需要正确的 CORS，否则画布可能被污染而无法读取。

**Moose 边界：** 当前 Markdown 图片显示占位，附件另有预览流程，没有实时图像编辑器。本题作为设计题回答。

### 4. 在AI代码编辑器中，如何优化语法高亮、代码折叠、错误波浪线的渲染性能，避免输入卡顿？

**可以这样答：** 编辑器应维护增量文档和可见范围，只重新分析变动区域。语法分析、语言服务和诊断放 Worker，标记结果带文档版本，丢弃旧版本。

输入即时回显，高亮可稍后更新；代码折叠维护区间信息，错误波浪线只创建需要的装饰，诊断防抖并取消过期任务。大文件限制昂贵语义分析，超长行单独降级。不要每按一次键就对全文件执行格式化、解析和 DOM 替换。

**Moose 实例：** 是只读回答/改动审阅，不是内置代码编辑器；`rehype-highlight` 展示代码块。长代码高亮开销可通过按需加载语言、缓存已完成内容、限制超大块高亮来改进，但这些不能全部算作现有成果。

### 5. 设计一个“按需加载”策略，仅渲染AI对话列表中可视区域及附近的消息，其余部分保留为纯文本。

**可以这样答：** 用 IntersectionObserver 或虚拟列表判断可见区，只有靠近视口的消息挂载富文本、高亮和图片，其余保留轻量纯文本或占位；临近屏幕提前加载，减少滚动时的空白。

注意纯文本与富文本高度不同，要测量并缓存高度；重新进入时复用解析结果。流式尾部保持轻量，停止后再做完整美化。过小 overscan 会频繁挂载，过大则抵消优化。

**Moose 实例：** 已有分页和 `content-visibility`，后者可能跳过浏览器的屏外渲染工作，但不会阻止 ReactMarkdown 被创建和执行。要实现“只有可见区才解析”，还需独立的可见性与组件挂载控制。

### 6. 如何用WASM加速前端本地的AI推理（如句子嵌入、相似度计算），并实现与JavaScript的无缝交互？

**可以这样答：** WASM 适合把大量数值计算放进编译后的模块，例如一批向量点积；先批量传入 Float32Array，再批量取结果，避免每个元素跨 JS/WASM 边界调用。

耗时计算仍放 Worker，WASM 在主线程执行照样可能阻塞。管理线性内存、输入输出缓冲和释放，按能力选择 SIMD/多线程，线程共享内存需满足跨源隔离等环境条件。先比较加载成本、数据拷贝和真实计算时间，不能假定 WASM 一定更快。

本题只讲 WASM 与数值计算，不展开用户排除的推理库。**Moose 没有浏览器本地推理**，模型工作交给代理 CLI 和服务。

### 8. 请设计一个“渲染优先级”调度器，确保AI生成中的关键UI（如输入框、发送按钮）始终响应迅速。

**可以这样答：** 把任务分成输入/停止等即时交互、可延后的回答展示、后台历史索引三个层级。高频流事件先入缓冲，再批量提交 UI；非紧急 React 更新可用 transition，重计算拆块或放 Worker。

requestAnimationFrame 适合合并绘制前更新，不代表适合塞一大段计算；requestIdleCallback 只能做可推迟且有兜底的工作。队列要有长度上限和取消能力，后台标签页计时器会被节流，不能让关键保存只依赖渲染帧。

**Moose 实例：** 80ms 合并消息更新，审批 pending 会立即 flush，任务执行位于独立后台。这是“不同变化用不同刷新策略”的具体例子；没有自研 React 渲染调度器。

### 9. 如何用React.memo、useMemo、useCallback避免AI消息列表因无关状态变更导致的全量重渲染？

**可以这样答：** `memo` 判断 props 是否变化，`useMemo` 缓存计算结果，`useCallback` 稳定函数引用。先让数据更新保留未变对象的引用，再考虑这些工具，否则每次全量深拷贝会让 memo 失效。

**Moose 实例：** `TranscriptRow` 和 `Markdown` 被 memo 包装；`mergeMessages` 用 Map 替换变化记录，其他 Message 对象保持原引用。某条回答变化时，其他行更有机会跳过渲染。不过 `busy/latestUser/lastAssistant/onError/onEdit` 改变也会影响 memo，Context 更新也会让消费组件更新，不能承诺只渲染一行。见 [时间线](../../src/components/transcript.tsx)、[memo 官方说明](https://react.dev/reference/react/memo)。

验证用 React Profiler 看 commit 时间和渲染原因，而不是只数 Hook 数量。比较函数不要漏掉影响输出的 props，也不要为省渲染增加更昂贵的深比较。

### 10. 在AI多模态输出（文本+图像+表格）场景中，如何分阶段渲染以提升首屏速度？

**可以这样答：** 优先显示可读文字和结构占位，再加载图片与高亮，最后处理大表格、图表等昂贵部分。每个部分有自己的 loading/error，避免一个图片失败拖住整条回答。

图片提前给宽高或 aspect-ratio 防止布局跳动，屏外懒加载；表格先展示前几行或轻量预览，点击再展开；长代码先纯文本后高亮。阶段切换仍要保留相同片段 ID 和滚动锚点。

**Moose 实例：** 用户附件和代理正文分开显示，工具/思考默认通过折叠区域呈现；但没有完整的多模态分阶段渲染管线。可以结合现有消息种类说明设计思路，不把预览占位说成真实图像生成能力。

<a id="part-5"></a>

## 五、前端AI架构设计

### 1. 请设计一个“微前端+模块联邦”的AI应用架构，支持独立部署聊天、编辑、可视化等子应用。

**可以这样答：** 宿主负责登录、路由、主题和公共布局，聊天、编辑、可视化分别有明确的挂载/卸载协议，各自构建发布。模块联邦只是运行时加载和共享模块的一种方式，不等于完整微前端治理。本题不展开被排除的构建工具。

先约定共享依赖版本，尤其 React 实例不能随意重复；子应用通过宿主 SDK 访问身份和全局配置，不直接引用对方内部 store。样式使用作用域，路由加前缀，加载失败局部降级。远端入口做版本固定、来源白名单和兼容回滚，避免子应用独立发布把宿主一起带崩。

**Moose 边界：** 当前是统一构建的 Electron 应用，不是微前端。对于当前本地工作区体量，用普通模块划分成本更低；只有团队与发布边界确实独立时，才值得引入运行时组合。

### 2. 如何用Monorepo管理AI前端、Node.js中间层、共享类型定义、工具脚本的统一代码库？

**可以这样答：** Monorepo 是多个包放在同一个仓库协作，不是“目录多”就算。可分 `apps/web`、`apps/server`、`packages/contracts`、`packages/ui`、`tools`，用 workspace 管内部依赖和统一锁文件。

共享包只放跨边界稳定内容，不能让浏览器因为导入一个类型而带进 Node 运行时依赖；使用 `import type` 和显式 exports。CI 按依赖图构建受影响包，共享配置集中维护，各包仍能独立验证。不要把任何重复代码都提成公共包，先看是否真的具有共同变更节奏。

**Moose 实例：** 当前只有一个根 package.json，`src/electron/shared` 是逻辑分层，**不是多个 workspace 包组成的 Monorepo**。其中 `shared/types.ts` 和 `shared/validation.ts` 已体现共享契约价值，若项目扩大可作为拆包起点。

### 3. 设计一个“插件化”AI前端框架，允许第三方开发者通过插件扩展模型接入、UI组件、工具调用。

**可以这样答：** 插件接口要先定义能力和生命周期，再考虑动态加载。模型插件负责调用与事件转换，工具插件声明名称、参数 Schema 和权限，UI 插件只进入约定的插槽。

插件清单记录 ID、版本、兼容宿主范围与所需能力；注册时检查重复 ID，卸载时取消任务、移除监听、释放资源。第三方不可信代码放受限 Worker/进程/iframe，不能直接拿到数据库或任意文件权限。一个 TypeScript interface 只能约束开发体验，不是安全沙箱。

**Moose 实例：** `AgentAdapter` 统一 `probe/run/respond/cancel/close`，可选 `usage/fork` 表达能力差异。新增 provider 还需修改类型、校验、发现和 UI，不是“把插件放进目录就自动安装”。文件中的 skills 是代理上下文资源，也不等于第三方 UI 插件运行时。

### 4. 在AI多租户SaaS平台中，如何设计前端架构以支持动态主题、自定义域名、独立功能开关？

**可以这样答：** 租户身份由服务端验证域名与登录关系后确定，返回主题、品牌资源和功能配置；前端根据配置渲染，API 请求和缓存键都带租户边界。

主题使用语义化 CSS 变量，配置有 Schema、版本和默认值。自定义域名涉及 DNS、证书和服务端路由；功能开关可以控制 UI，但数据权限必须在服务端再次验证。切换租户要清理旧缓存和连接，避免 A 租户数据出现在 B 租户页面。

**Moose 边界：** 本地 Project 是目录组织单位，不是 SaaS 租户。当前没有租户鉴权、自定义域名或租户计费，不能套成已有经验。

### 5. 如何用DDD（领域驱动设计）划分AI前端的核心领域（对话、模型、工具、知识库）与界限上下文？

**可以这样答：** DDD 的重点是按业务责任和规则划边界。对话域负责会话与消息，执行域负责排队/取消/审批，模型接入域处理服务商能力，知识库域负责文档与检索；各域通过 ID 和明确接口协作。

不要把数据库表直接等同于领域，也不要为每个名词机械地建一层。应优先隔离变化来源：换代理协议，不应改消息 UI；换存储，不应重写队列规则。

**Moose 实例：** Project/Session/Message/QueueItem 是核心业务概念，Service 负责用例与调度，Provider 隔离协议，Store 隔离持久化。可以用它解释分层，但源码并非严格的富领域模型：规则仍集中在 Service，不能说已经全面落地 DDD。见 [Service](../../electron/service.ts)、[类型](../../shared/types.ts)。

### 6. 设计一个“事件驱动”架构，用EventEmitter或MessageChannel解耦AI各个模块（输入、处理、输出）。

**可以这样答：** “请求做一件事”用命令/请求，“已经发生什么”用事件。例如输入发 `send` 请求，后台完成保存后发 `message`；不要把需要返回结果的调用也做成找不到响应方的全局广播。

事件包含类型、实体 ID、版本；请求有 requestId、超时和错误。订阅返回取消函数，卸载清理，重复事件幂等处理；事件风暴要合并，消费者落后时通过快照补齐。EventEmitter 默认同步调用监听，不自动提供线程隔离。

**Moose 实例：** preload 暴露 `request/subscribe`，RuntimeHost 用 ID 关联 Promise，`message` 直接更新记录，`changed` 合并后重新读快照，`transcript-reset` 使旧历史失效。这条链路可说明为什么同时需要增量事件与重新拉取。见 [preload](../../electron/preload.ts)、[RuntimeHost](../../electron/runtime-host.ts)、[workspace](../../src/lib/workspace.ts)。

### 7. 在AI实时协作场景中，如何用OT（操作转换）或CRDT实现多用户并发编辑的冲突解决？

**可以这样答：** OT 把并发编辑操作根据其他操作做位置转换；CRDT 给内容与操作稳定身份，使不同接收顺序最终能收敛。两者都需要清楚定义文档模型和同步协议，不是简单按时间戳覆盖全文。

例如两个人同时在位置 0 插字，不能让后到的完整文本覆盖先到者；用成熟协作文档实现操作合并，光标使用相对位置。还要处理离线重连、快照压缩、权限、撤销语义和协议版本。AI 批量改文档也是一个参与者，应基于版本提交建议或事务，避免覆盖人刚改的内容。

**Moose 边界：** 按目录串行只能减少本客户端的写冲突，不是多用户协作，也不约束外部编辑器或单独运行的 CLI。

### 8. 如何设计一个“配置驱动”的AI工作流引擎，前端通过JSON或YAML定义节点、连接线、条件分支？

**可以这样答：** 配置描述节点类型、输入输出、边和条件，运行时负责解释执行。配置加载后先校验节点 ID 唯一、边存在、输入类型兼容、入口出口合法；DAG 可拓扑排序，有循环则必须定义次数或终止条件。

```json
{
  "version": 1,
  "nodes": [
    { "id": "draft", "type": "model" },
    { "id": "check", "type": "validate" }
  ],
  "edges": [{ "from": "draft", "to": "check", "when": "success" }]
}
```

每次执行保存 `workflowVersion/runId/nodeId/attempt` 和结果。节点有超时、取消、幂等与重试策略；条件使用受限 DSL 或规则对象，不对用户 JSON 执行 `eval`。流程图只负责编辑配置，真实执行器不应依赖图上的 DOM。

**Moose 边界：** `PromptContext.mode` 是 build/plan/goal 模式，不是 JSON 工作流引擎；现有 queue/run/event 可以作为未来执行层的参考。

### 9. 请设计一个“前后端分离”的AI应用，前端直接调用多个AI服务商API，后端仅做鉴权与计费代理。

**可以这样答：** 这道题的前提要补全：如果前端携带平台长期密钥直连模型，后端很难可靠保护密钥并独立确认用量。通常由后端/BFF 持有密钥，鉴权、限流并转发流式响应。

确实需要直连时，前提是服务商支持作用域受限的短期凭证和相应跨域策略，或明确采用用户自带凭证；服务端仍要验证用量，不能信任浏览器上报的账单。统一 provider 接口，错误映射、取消、超时放公共层，服务商差异留适配器。

**Moose 实例：** Renderer 不直连模型，也不保存平台 API Key。它经 preload/main/runtime 接到本机 CLI，复用 CLI 的认证，再由 CLI 与服务通信。这是桌面客户端模式，和 SaaS 计费代理不同。

### 10. 在AI嵌入式场景（如IDE插件）中，如何设计轻量级SDK，提供一致的API供宿主应用调用？

**可以这样答：** SDK 核心只暴露稳定的能力，例如 `createSession/send/subscribe/cancel/dispose`，传输由宿主适配，UI 做可选包，避免 SDK 自带整套框架和全局样式。

异步操作有任务 ID、取消信号、明确错误码，事件协议版本化；宿主声明文件、剪贴板、网络权限，SDK 不偷偷依赖 Node 全局变量。支持能力探测和降级，测试使用假的 transport，验证不同宿主实现遵守同一契约。

**Moose 实例：** `window.moose` 是面向 Renderer 的小型桥接 API，方法参数与返回值按类型映射；preload 不暴露原始 Electron IPC 对象。它是内部接口，可作为 SDK 设计例子，但当前没有发布通用 IDE SDK。

<a id="part-6"></a>

## 六、AI特性与前端工程实践

### 1. 在前端实现一个Agent循环时，如何管理工具调用的异步执行、超时处理与结果合并？

**可以这样答：** Agent 循环是“请求模型 → 收集工具调用 → 校验并执行工具 → 回传结果 → 再请求模型”，直到完成、取消或达到轮次/预算上限。工具名必须来自白名单，参数先过 Schema，不能执行模型随意给的函数名或字符串代码。

独立只读工具可以有界并发；有依赖或有写副作用的工具按顺序执行。每个 callId 对应一个结果，超时和失败也返回结构化结果，不能漏项。设置 AbortSignal、远端取消和幂等键；`Promise.race` 超时只是先拒绝，不会自动停止底层操作。

**Moose 实例：** 完整模型循环和工具执行主要在代理 CLI，Moose 管运行生命周期、展示工具事件、转发审批与取消。`respond` 会验证请求仍 pending，结束后未答复请求过期。不要把“展示工具调用”讲成“自己实现所有工具执行”。见 [Service](../../electron/service.ts)、[Adapter](../../electron/providers/types.ts)。

### 3. 在AI产品中，前端可以通过哪些技术手段（如缓存、压缩、懒加载）帮助降低Token成本？

**可以这样答：** 真正影响 token 成本的是送进模型和模型生成的内容。可以去掉重复上下文、按需引用文件片段、总结过长历史、给出明确输出范围，对相同且允许复用的请求使用结果缓存，用户取消后及时通知服务端停止。

HTTP gzip 压缩只减少传输字节，不会自动减少模型 tokenize 后的数量；页面懒加载历史也不代表后端少发历史。缓存键应包含模型、Prompt 版本、参数和权限范围；不能把不同用户的私有结果混用。

**Moose 实例：** 文件/技能引用可显式选择，发送前解析；上下文用量由代理返回。它没有自行实现完整 token 裁剪和费用结算。historySeed 是上下文恢复兜底，也不能称为智能压缩。

### 4. 如何建立AI生成内容的质量评估体系？前端可在交互层面提供哪些反馈机制（如评分、标注、修正）？

**可以这样答：** 先明确“好”的标准：正确性、任务完成率、格式遵循、相关性、耗时与成本。准备固定测试集和边界案例，对同一版本重复评估；主观回答用人工盲评或经过校准的评审模型，不能只看点赞率。

前端提供赞/踩加原因、选中错误片段、修正答案、是否成功执行等反馈，关联模型/Prompt 版本和 runId。区分“复制了内容”与“内容正确”，避免把用户行为直接当质量真值。

**Moose 实例：** 可围绕工具结果、Git diff 和任务最终状态设计评估。当前有测试与审阅入口，但没有评分平台、反馈闭环或经过验证的成功率指标。

### 5. 在处理AI幻觉（Hallucination）时，前端可以设计哪些实时提示与用户教育交互？

**可以这样答：** 给用户看得见的依据和验证入口：引用来源能点开、事实标明时间、工具查询展示真实结果，生成的代码提供差异与检查结果。模型没有依据时明确说未知，不展示伪造的置信度数字。

对于高影响操作，把“建议”和“已经执行”区分开，让用户确认具体改动。内容检查可以发现引用缺失和格式问题，但不能保证实时识别所有幻觉。

**Moose 实例：** 工具记录和只读 Git diff 让用户能检查代理实际改了什么；pending 审批让执行与用户授权相衔接。任务 completed 只表示执行流程结束，不保证代码正确，仍需测试与审阅。

### 6. 如何实现前端本地的敏感词过滤与内容安全审核，在发送至AI服务前进行初步筛查？

**可以这样答：** 本地初筛可以用规范化文本、词典匹配和规则识别疑似密钥、手机号等，命中后高亮并让用户修改或确认；长词典可以用 Trie/多模式匹配，避免每个词都扫全文。

保留原文并维护规范化位置映射，减少大小写、全半角和分隔符绕过；同时处理误报，例如代码变量名。词典版本化，日志只记录规则编号和脱敏摘要。前端检查容易被绕过，只是交互与隐私保护的第一层，受控服务仍需服务端校验。

**Moose 边界：** IPC 的长度/路径校验属于输入边界检查，不是敏感词审核。当前没有完整内容安全审核模块，不要混称。

### 7. 请设计一个前端实验平台，支持对AI模型参数（温度、top_p）、Prompt模板、UI布局进行A/B测试。

**可以这样答：** 稳定分桶、单变量控制、可信指标是重点。用实验 ID 与用户/会话 ID 做确定性分桶，固定实验期间版本，避免同一用户频繁换组。

记录曝光、模型参数、Prompt 版本、延迟、失败和质量反馈。AI 输出有随机性，要保持样本可比，设主指标和成本/错误率等护栏；不要看几条答案就下结论。界面实验也应看任务完成率，而不只是点击量。实验变更可快速关闭，数据按用户维度避免把同一个人的多轮交互当成独立样本。

**Moose 边界：** 现有模型和 effort 选择是用户配置，不是随机实验；没有 A/B 平台，本题按设计回答。

### 8. 如何用WebAssembly在前端运行轻量级AI模型（如TinyLLM、蒸馏模型），实现离线推理？

**可以这样答：** 离线推理要同时有可在目标运行时执行的模型、tokenizer、权重和推理代码，WASM 只是其中的执行技术。先选设备能承受的模型体量和量化格式，再按需下载、校验和缓存。

推理放 Worker，限制上下文和输出长度，支持进度、取消、内存不足降级。测首轮加载、首 token、稳态速度和峰值内存；模型权重和缓存可能远大于页面资源。断网前没有下载成功就不能承诺离线可用。

**Moose 边界：** 没有 WASM 本地模型，不能称为离线 AI。这里保留一般原理，不展开用户排除的推理库。

### 9. 在AI多轮对话中，如何设计上下文窗口的管理策略（如滑动窗口、关键信息提取、自动摘要）？

**可以这样答：** 把上下文预算分成系统约束、近期对话、重要记忆、检索材料、工具结果和输出预留。先保留必须的指令与最近任务，再缩短重复材料、截取相关片段，超限时总结早期历史。

摘要保留决定、约束、未完成事项和来源，并保存原文以供追溯；不能把模型摘要当成完全正确的原始事实。工具调用与对应结果要成对保留，不能只删掉其中一个。token 数以对应模型的统计为准，字符长度仅能粗估。

**Moose 实例：** `nativeId` 用于恢复代理端会话，Codex 上下文统计会持久化；Moose 没有自己实现自动摘要压缩算法。编辑最后一轮时的 `historySeed` 是重建可见历史，不等于摘要。见 [Service](../../electron/service.ts)。

### 10. 如何实现AI生成结果的“一键格式化”（如Markdown转富文本、代码缩进、表格对齐）？

**可以这样答：** 先把原始内容解析成结构，再按目标格式序列化。Markdown 转富文本走 AST 到编辑器节点；代码使用对应语言 formatter；表格根据单元格结构对齐，不靠大量正则替换整段字符串。

保留原文与格式化结果，支持撤销和预览；代码语法错误时报告原因而不是强改。插入富文本前清理不安全节点和链接，格式化只改善表达形式，不证明内容正确。

**Moose 实例：** 当前渲染 Markdown 并支持复制整轮 assistant 文本，没有一键富文本转换/代码格式化引擎。复制通过 `responseText(sessionId, runId)` 获取全部回答，避免只复制当前分页中的最后一段。

<a id="part-7"></a>

## 七、AI工程化与前端工具链

### 1. 如何设计一个AI前端项目的标准化目录结构，兼顾业务功能、共享组件、工具函数与类型定义？

**可以这样答：** 顶层按运行环境和业务边界分，功能内部再放组件、状态和工具。共享目录只容纳真实复用的内容，避免一个 `utils.ts` 装下所有业务。

**Moose 可直接举例：** `src` 管 React，`electron` 管本机能力，`shared` 管 IPC 类型与校验；`electron/providers` 隔离代理协议，`electron/db` 管存储，`tests/unit` 和 `tests/e2e` 分别验证逻辑和完整交互。依赖方向是 UI 经桥接调用后台，浏览器代码不直接 import 数据库。

这套结构的意义是定位问题：展示错看 Transcript，消息乱序看 workspace/Service，协议错看 Adapter，历史丢失看 Store；比只背目录名称更容易讲清楚。

### 2. 请设计一套AI前端代码规范（ESLint、Prettier、Commitlint），并集成Git Hooks自动检查。

**可以这样答：** ESLint 管潜在错误和代码规则，Prettier 管格式，TypeScript 管类型；Commitlint 管提交信息格式。规则集中配置，但生成代码、构建产物和外部代码要排除，避免大量无意义告警。

重点规则围绕 Hook 使用、未处理 Promise、危险类型逃逸、导入边界等真实风险；格式规则不要在两个工具里重复打架。Git Hook 提供提交前反馈，CI 才是不可绕过的质量门禁。先逐步清理存量，再对新增改动启用严格检查。

**Moose 实例：** 当前 package.json 提供 typecheck/test/build，未配置完整 ESLint/Prettier/Commitlint 流程。本题可提出方案，不能说已经接入全套。

### 3. 如何用Husky、lint-staged、Commitizen打造AI项目的自动化提交与代码质量流水线？

**可以这样答：** Husky 负责安装 Git Hooks，lint-staged 让提交前检查只处理暂存文件，Commitizen 引导填写提交信息，commit-msg 再做格式校验。三者解决的问题不同。

pre-commit 只跑快速 lint/format，不在每次提交都跑完整 E2E；类型检查可能依赖整个项目，不应简单把 TS 文件列表逐个传给 tsc。处理好部分暂存，避免格式化把未打算提交的改动一起带入。完整测试与构建放 CI，允许团队使用正常 Git 提交方式而不是强制依赖交互工具。

**Moose 边界：** 当前没有这些依赖和 hooks 配置，不写成已有流水线经验。

### 4. 设计一个AI前端项目的CI/CD流水线，包括代码检查、单元测试、E2E测试、构建优化、自动部署。

**可以这样答：** PR 阶段安装锁定依赖，跑类型检查、单元测试、构建和关键 E2E；发布阶段从同一个已验证提交生成带版本的产物，上传制品，再灰度或手动发布，并保留回滚入口。

缓存以系统、运行时版本和锁文件为键，测试使用临时数据与 mock；真实模型调用另设受控验收，避免每次 PR 消耗额度并受网络波动影响。密钥只在所需任务注入，不写到前端包或日志。

**Moose 实例：** 已有 Vitest 和 Playwright Electron 测试、mock agent、provider/live 脚本，`pnpm build` 包含类型检查，`pnpm dist` 构建 macOS DMG。但当前仓库没有 `.github` 工作流，**现成命令不等于已经自动化部署**。原生 SQLite 还需要匹配 Electron ABI 与架构。见 [package.json](../../package.json)、[测试](../../tests/unit/service.test.ts)。

### 5. 如何用Docker容器化AI前端应用，实现开发、测试、生产环境的一致性？

**可以这样答：** 对普通 Web 应用，Docker 多阶段构建：构建阶段安装锁定依赖并编译，运行阶段只放静态资源和 Web 服务配置；运行时环境通过受控配置注入，不把密钥烘焙进 JS。

固定基础镜像版本、使用非 root、健康检查、合理缓存和小体积产物。容器保证部分环境一致，不会让不同浏览器行为完全一致。

**Moose 实例：** 它是 macOS Electron 客户端，Linux 容器不能替代 macOS 原生打包、签名和桌面交互验收。可用于可移植的检查环节，但最终 Apple Silicon 安装包仍要在匹配环境验证；不能硬套成 Nginx 部署方案。

### 6. 请设计一个AI前端性能监控方案，收集FP、FCP、LCP、CLS等核心指标，并关联AI特定指标（如Token/s）。

**可以这样答：** 页面性能与 AI 请求性能分开统计，再通过一次交互的 traceId 关联。FP/FCP 看初次绘制，LCP 看主要内容出现，CLS 看布局稳定性；交互还应看 INP，别只关心首屏。指标的精确聚合和生命周期可交给成熟实现，不能把每条 observer entry 直接当最终指标。

AI 侧记录请求开始、首个有效内容、最后内容和完成时间，得到 TTFT、生成时长、成功/取消/失败、tokens/s。工具等待和用户审批分段计时，分位数按设备、模型、版本统计；不要只看平均值。Token 数未知时保持未知。

**Moose 实例：** 目前有上下文和账号额度展示，**没有完整性能监控面板或遥测**。可在 Renderer、RuntimeHost、Adapter 三层分别加时间点，区分 UI 卡顿、IPC 等待与代理慢。浏览器采集入口参考 [PerformanceObserver](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver)。

### 7. 如何用Sentry或Bugsnag监控AI前端异常，自动捕获错误上下文（用户输入、模型参数、网络状态）？

**可以这样答：** 按你的经历，只讲 Sentry 基础使用：“我轻度用过 Sentry，主要理解错误采集、上下文和定位流程；完整监控平台搭建没有深度实践。”

接入后关注未捕获异常、未处理 Promise 和主动 `captureException`；附加 release、环境、模型、runId、操作类型与网络状态，通过 breadcrumbs 理解错误前发生什么。source map 与构建产物版本对应，才能还原压缩堆栈；上传与发布应在 CI 内关联。

题目说的“用户输入”不应原样自动采集：Prompt、附件、密钥和本地路径要脱敏，限制体积；过滤取消等预期错误，减少噪声。不要说自己做过深度回放、复杂采样或告警治理。参考 [Sentry 官方排错速查](https://docs.sentry.io/pdfs/developer-quick-reference-guide.pdf)。

**Moose 边界：** 当前没有 Sentry 集成。它的 UI 错误展示和运行进程异常事件，不能等同于远程异常监控。

### 8. 设计一个AI前端日志系统，结构化记录用户操作、AI请求、响应时间、错误信息，便于回溯分析。

**可以这样答：** 日志用结构化字段串起一次操作：`timestamp/level/event/sessionId/runId/requestId/provider/duration/errorCode`。同一 runId 贯穿排队、启动、首输出、审批、结束，查问题时才能还原一条完整链路。

普通日志记录状态和摘要，调试日志按需开启；限制体积、轮转、脱敏，重复错误聚合。区分业务事件与诊断日志，不能直接把所有聊天正文当日志上传。

**Moose 实例：** Session、runId、消息 kind/state/seq 已有，适合建立关联；但当前 messages 表是用户可见的历史，不是完善的结构化日志平台。协议层 pending Map 与 RuntimeHost 请求 ID 也属于关联基础。

### 9. 如何用Webpack或Vite优化AI前端构建性能，实现代码分割、Tree Shaking、预加载、持久缓存？

**可以这样答：** 本题只讲 Vite。先分析构建耗时和产物，再按路由或重量级功能动态 import，避免首屏带上所有编辑器、图表和语言高亮模块。依赖保持可静态分析的 ESM，正确标记副作用，才有利于 Tree Shaking。

开发依赖预构建缓存、浏览器 HTTP 缓存、生产文件哈希缓存是不同层次。预加载只用于马上需要的模块，过多会抢首屏带宽；部署保留旧版本 chunk 或提供刷新恢复，避免老页面引用已删除资源。具体分包配置随 Vite 版本变化，以当前版本 API 为准。参考 [Vite 构建](https://vite.dev/guide/build)、[性能](https://vite.dev/guide/performance)。

**Moose 实例：** Vite 配置构建 main/preload/runtime，preload 输出 CJS，其他后台入口 ESM；better-sqlite3 作为原生依赖处理。Renderer 生产构建未开启 sourcemap，后台构建开启了，若接监控要按入口配置，不能一概而论。见 [vite.config.ts](../../vite.config.ts)。

### 10. 请设计一个AI前端依赖管理策略，定期更新模型SDK、工具库，并评估兼容性与性能影响。

**可以这样答：** 锁定直接依赖和 lockfile，按小批次更新，先看变更日志与迁移说明，再跑类型、契约、回归和体积检查。核心模型 SDK 的升级重点是流事件、工具参数、取消和错误结构，不仅仅看能不能安装。

次版本与主版本分开处理，安全补丁及时评估；自动升级可以创建 PR，不必自动发布。保留可回滚制品，协议生成代码在受控步骤更新，避免手改生成文件。

**Moose 实例：** package.json 使用精确版本，`protocol:generate` 生成 Codex 类型；ACP、Electron 与 better-sqlite3 更新分别涉及协议兼容和原生 ABI。mock 测试能验证应用逻辑，真实 CLI 登录、模型与额度仍需专门验收。

<a id="part-8"></a>

## 八、大模型前端集成

### 1. 如何用OpenAI Function Calling或Tools在前端实现AI工具调用（如计算器、搜索、数据库查询）？

**可以这样答：** 模型返回工具名称和参数，应用验证并执行，再把结果交回模型；模型“提出调用”不等于已经执行函数。工具定义需要清楚的说明和参数 Schema，流式参数必须收齐后再执行。

以搜索为例：注册 `search({query})` → 收到 function call → 解析并校验 query → 调用受控搜索服务 → 按原 call_id 返回结果 → 模型继续回答。可能一次返回多个调用，要逐一匹配结果。工具错误也应结构化返回，循环设置轮次与预算上限。参考 [OpenAI Function Calling](https://developers.openai.com/api/docs/guides/function-calling)。

浏览器可执行纯计算或展示工具；数据库、密钥、任意命令放可信后端，做权限和幂等校验。不能把 `eval` 当计算器，也不能信任模型给的 SQL。

**Moose 实例：** CLI 执行工具循环，Adapter 转换工具/审批消息，用户答复经 `respond` 关联回原协议请求。Moose 实现的是客户端执行管理与审批桥接，并非 Renderer 直接调用上述 API。

### 2. 请设计一个模型性能监控面板，实时展示各模型的响应时间、成功率、Token消耗与成本。

**可以这样答：** 每次模型调用记录唯一 ID、模型/版本、排队时间、TTFT、总时长、状态和 token usage；按分钟聚合成功率、p50/p95 延迟与成本，明细可定位到单次请求。

成本按服务商确认的输入、输出、缓存等计费项以及对应价格版本计算。缺失 usage 不能当 0，估算值单独标识；取消是否计费以实际返回/账单为准。多模型比较还要控制任务复杂度，不能把回答短的模型直接评成最快最好。

**Moose 实例：** 用量面板展示账号额度和会话上下文；Service 缓存额度并合并同 provider 的并发请求。它不是响应时间/费用看板，套餐剩余百分比也不是这次任务消耗的金额。

### 4. 如何实现模型调用的“请求合并”，将多个用户的相似问题批量发送，提升吞吐并降低成本？

**可以这样答：** 先区分三种情况：完全相同的只读请求可共享正在进行的 Promise；服务商支持的 batch 可以把多个独立任务批量提交；“相似问题”复用答案属于语义缓存，必须额外判断正确性与权限。

不能简单把多个用户的 Prompt 拼在一次聊天里，这可能串数据、改变回答质量，也不保证更便宜。批量请求设置小等待窗口、数量/字节上限，结果按 requestId 分发，单项失败单独重试；实时对话不能为了吞吐等待太久。

**Moose 实例：** `usagePending` 按 provider 共享正在进行的用量查询 Promise，完成后清理，并有约 60 秒缓存。这是可靠的同类只读请求合并；聊天生成涉及独立上下文和副作用，不会这样合并。见 [Service](../../electron/service.ts)。

### 5. 如何用WebSocket实现双向流式通信，支持AI模型主动推送进度更新、中断信号、工具调用请求？

**可以这样答：** WebSocket 连接后定义业务信封 `{type, requestId, runId, seq, payload}`，区分开始、增量、进度、工具请求、取消、完成和错误；不同任务共享连接时按 ID 分流。

连接建立后鉴权，校验来源，定期做应用层心跳；限制发送队列和 `bufferedAmount`，避免慢消费者占满内存。重连需要恢复游标和服务端事件保留，不能仅 `new WebSocket` 就叫恢复。取消后等待服务端确认，晚到的旧事件按任务代次丢弃。

**Moose 类比：** RPC/IPC 同样用 ID 区分请求与通知，但传输是本地进程通道。可以复用消息关联、超时清理和失效处理的思路，不能称为已有 WebSocket 服务。

### 6. 如何用Server-Sent Events实现模型输出的“进度条”与“部分结果预览”？

**可以这样答：** 服务端通过 SSE 推送 `delta/progress/done/error` 事件；前端累计部分正文，并独立展示任务状态。有真实总步骤时显示 `completed/total`，没有总量时用不确定进度和已生成信息。

连接成功不是任务完成，流正常断开也未必代表成功，最好要求明确 done 事件。后台代理/CDN 要避免缓冲流，服务端定期心跳，页面取消要调用任务停止接口。长文本预览批量渲染，不为每个字符重建全部 DOM。

**Moose 实例：** 相同 UI 思路由 `message` 和会话状态事件实现。现有上下文进度不能代替回答进度；审批时显示等待用户，不伪造剩余时间。

### 7. 如何用Web Workers并行调用多个模型，实现“模型投票”或“结果融合”？

**可以这样答：** 多模型请求可通过有并发上限的异步任务直接发起，Worker 主要用于结果解析、评分或融合的重计算。每个结果保留模型和任务来源，超时返回部分结果，失败不拖住全部任务。

明确投票规则：结构化分类可多数投票；开放文本要用明确评分维度、人工选择或额外评审步骤。多个模型可能重复同一错误，多数不等于事实，融合还会增加延迟和 token 成本。用户取消时同步停止所有子任务。

**Moose 边界：** 不同项目可并行，但当前没有自动多模型投票/融合，同一实际目录仍受互斥约束。不能把支持多个 provider 说成已有 ensemble 系统。

<a id="part-9"></a>

## 场景题

### 1. 如何判断用户设备

**可以这样答：** 先问判断设备是为了什么。布局适配看视口和媒体查询，交互方式看 `pointer/hover` 能力，功能是否可用就做 feature detection；只有下载对应安装包等场景才需要系统/架构信息。

UA 可以辅助判断但会被伪装，平板也可能使用桌面 UA；不要仅靠 `window.innerWidth < 768` 判定一定是手机。`navigator.userAgentData` 要做兼容检测，不能作为唯一方案。

**Moose 实例：** 运行在 Electron，后台可以通过 Node/Electron 获得平台信息，Renderer 需要的能力通过受控桥接提供。当前发行目标是 macOS arm64，这不代表已做好多平台适配。

### 2. 将多次提交压缩成一次提交

**可以这样答：** 自己分支中连续的最近几次提交，可以交互式 rebase，把后续提交标记为 squash/fixup；也可以 soft reset 后重新提交。先保存未提交工作并确认基准提交。

```bash
git rebase -i HEAD~3
# 保留第一条 pick，后两条改为 squash 或 fixup
```

这样改变提交历史；已经共享的分支要先协调，确需更新远端时使用 `--force-with-lease` 检测远端变化，而不是直接覆盖。合并主分支时如果只想最终保留一个提交，也可使用平台的 squash merge。这里只解释操作，不对当前仓库执行。

### 3. 介绍下navigator.sendBeacon方法

**可以这样答：** `navigator.sendBeacon` 适合在页面离开前发送少量埋点，通过异步 POST 排队发送，不需要等待响应。

```js
const queued = navigator.sendBeacon('/telemetry', JSON.stringify({ event: 'leave' }));
```

返回 true 表示浏览器接受排队，不表示服务端已收到；不能任意设置方法或请求头，也拿不到响应体。它有小体积配额，不能上传大日志；跨域同样受浏览器安全规则约束。需要自定义请求属性时可考虑 `fetch(..., { keepalive: true })`。参考 [MDN sendBeacon](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon)。

### 4. 滚动跟随导航（电梯导航）该如何实现

**可以这样答：** 这里按“滚动跟随导航/电梯导航”理解。点击导航滚到对应内容，用户手动滚动时再反向更新当前导航项。

导航链接指向章节 ID，用 `scrollIntoView({behavior:'smooth'})`，章节加 `scroll-margin-top` 避开固定头部。用 IntersectionObserver 观察章节，根据距头部偏移选择当前章节；多段同时可见时规则要固定。点击触发平滑滚动期间要减少中途高亮跳动，但用户打断滚动后应恢复正常跟随。

监听实际滚动容器，支持键盘与减少动画偏好。页面很短或最后章节不足一屏时，额外处理滚动到底的选中规则。

### 5. 退出浏览器之前，发送积压的埋点数据请求，该如何做？

**可以这样答：** 平时定时或达到批量大小就上报，页面变为 hidden 时再尽力 flush，不能把所有埋点压到关闭时才发。

```js
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSmallBatch();
});
```

`flushSmallBatch` 把有事件 ID 的小批次交给 sendBeacon，失败则留在本地，下次可见时普通请求补报；服务端按事件 ID 去重。即使排队成功也不是送达确认，高可靠方案需要保留待确认状态并允许重报。进程被杀时任何关闭事件都可能没有机会触发。参考 [页面结束时的 Beacon 使用](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon)。

### 6. 如何统计页面的long task（长任务）

**可以这样答：** 用 PerformanceObserver 观察 `longtask`，记录主线程持续占用约 50ms 及以上的任务。先做支持性检测，避免在不支持的浏览器报错。

```js
if (
  typeof PerformanceObserver !== 'undefined' &&
  PerformanceObserver.supportedEntryTypes.includes('longtask')
) {
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      console.log({ start: entry.startTime, duration: entry.duration });
    }
  });
  observer.observe({ type: 'longtask', buffered: true });
  // 模块卸载时 observer.disconnect()
}
```

可统计次数、总耗时及发生场景，但 longtask 不是函数级 CPU profiler，通常不能直接指出哪个业务函数造成。定位还需要 Performance trace 和源码。**Moose** 可用它检查长回答解析是否卡住 Renderer；当前没有自动采集。参考 [Long Tasks API](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming)。

### 7. PerformanceObserver如何测量页面性能

**可以这样答：** 题目中的 `PerfoemanceObserver` 应为 `PerformanceObserver`。它订阅浏览器产生的性能条目，`performance.getEntries*` 则读取已有记录。

按需观察 `paint/navigation/resource/mark/measure` 等类型，支持时使用 buffered 获取之前的条目；自定义业务用 `performance.mark` 和 `performance.measure`。观察回调只做轻量收集，批量上报，结束后断开。

FP/FCP 可从 paint 区分，LCP/CLS 等要遵循各自聚合规则和页面生命周期；不同类型浏览器支持不同。**Moose** 可标记发送、入队确认和首条回答三个时间点，但跨进程不能直接相减各自的 `performance.now()`，要使用可比较时间或传递局部耗时。参考 [PerformanceObserver](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver)。

### 8. 移动端如何实现下拉滚动加载（顶部加载）

**可以这样答：** 顶部放一个 sentinel，接近顶部时加载更早的数据；用 loading、hasMore 和游标避免重复请求。数据插入前记录当前阅读位置，插入后补偿新增高度。

简单情况：插入前记录 `oldHeight` 和 `oldTop`，DOM 更新后设置 `scrollTop = oldTop + newHeight - oldHeight`。图片后加载还会改变高度，更可靠的方式是保存首个可见消息 ID 和相对偏移并持续校正。已有浏览器/组件滚动锚定时避免重复补偿。

**Moose 实例：** 使用 `before: position` 拉更早消息，每页 80 条，UI 当前由“加载更早”按钮触发，不是自动下拉 sentinel。现有滚动组件处理阅读跟随，可用来解释锚点需求。

### 9. 判断页签是否为活跃状态

**可以这样答：** 判断可见性用 `document.visibilityState` 与 `visibilitychange`；判断是否拥有输入焦点可配合 `document.hasFocus()`、focus/blur。可见和有焦点不是一回事，例如并排窗口。

```js
const visible = document.visibilityState === 'visible';
const focused = document.hasFocus();
```

后台暂停非必要动画/轮询，恢复时重新拉取有时效的数据。不要把页签 hidden 直接当成用户退出或停止后台业务。**Moose** 关闭窗口可以继续执行任务，所以 UI 生命周期与任务生命周期必须分开。

### 10. 在网络带宽一定的情况下，切片上传感觉和整体上传消费的时间应该是差不多的这种说法正确吗？

**可以这样答：** 理想条件下，总字节和可用总带宽相同，纯传输时间下限都接近 `数据量/带宽`，分片不会凭空增加带宽。但真实总时间还包含建连、请求头、调度、校验和合并。

分片能让失败只重传一小块，支持暂停续传和有界并发；太碎会增加请求开销，过多并发可能造成拥塞或服务端压力。HTTP/2 等也会改变请求复用成本。因此不能一概说完全相同，更不能说并发 5 片就一定快 5 倍。

### 11. 大文件切片上传的时候，确定切片数量的时候，有那些考量因素

**可以这样答：** 分片大小要在请求开销、失败重试代价、内存和服务端限制之间折中。先按文件大小与服务端最小/最大分片规则选大小，再用 `ceil(fileSize/chunkSize)` 算数量。

并发数与分片大小分开配置，根据网络和失败率调整；不要同时把全部分片读入内存。还要考虑最大分片数、文件哈希计算、移动端资源、上传会话超时和合并成本。比如“数 MB 一片、少量并发”只能作为压测起点，不是固定标准。

### 12. 页面关闭时执行方法，该如何做

**可以这样答：** 浏览器无法保证关闭时一定执行任意方法，更不能保证等待异步任务完成。重要状态平时就保存，hidden 时尽力补存，pagehide 可作补充。

`beforeunload` 主要用于确有未保存内容时提示用户，不应用来阻塞式发请求；移动端杀进程可能完全不触发。**Moose** 显式停止后台时有清理路径，安装版普通退出仅断开客户端，强制杀进程仍需依靠 SQLite 和重启状态恢复，而不是假设 close 回调总能跑完。

### 13. 如何统计用户pv访问的发起请求数量

**可以这样答：** 先确认是在问 PV，还是一次 PV 内发了多少接口请求。PV 通常是一次有效页面浏览，SPA 在约定的路由切换成功时上报一次，并带 pageViewId；不是每个网络请求都算 PV。

如果要统计“每次 PV 的请求数”，统一请求层记录 pageViewId，区分原始业务请求、重试、预取和埋点自身。路由切换后才返回的请求仍归属发起时的页面。服务端按事件 ID 去重，刷新/前进后退的口径提前约定。

### 14. 长文本溢出，展开/收起如何实现

**可以这样答：** 折叠时用 line-clamp 限行，展开时解除限制。只有真实溢出才显示按钮，测量 `scrollHeight > clientHeight` 并考虑字体、宽度和内容变化。

```css
.text[data-collapsed='true'] {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
  overflow-wrap: anywhere;
}
```

按钮带 `aria-expanded` 和 `aria-controls`，展开/收起保持阅读位置。复制可提供完整原文，不要因为视觉省略而截断数据。**Moose** 工具/思考使用 details 折叠，普通回答并不是强制三行截断。

### 15. 如何实现鼠标拖拽

**可以这样答：** 用 Pointer Events 统一鼠标和触摸。在 pointerdown 记录起点与元素位置，并 `setPointerCapture`，后续 pointermove 即使指针移出元素也能收到；pointerup/pointercancel 清理。

移动用 transform，合并到 requestAnimationFrame，避免每次事件都交错读取布局和写样式。拖动区域设置合适的 `touch-action`，限制越界、区分点击与拖动阈值，卸载时移除监听。可操作组件还应提供键盘替代方式。

如果是文件从系统拖入网页，用的是 drag/drop 与 DataTransfer，和自定义拖动元素的位置不是同一套需求。

### 16. 统计全站每一个静态资源加载耗时，该如何做

**可以这样答：** 当前页面用 Resource Timing 收集资源条目的 `duration`，PerformanceObserver 持续观察后续资源；增加资源缓冲容量或定期消费，防止长会话丢条目。全站则让各页面按采样策略统一上报。

资源按 initiatorType、路径、版本聚合，URL 去掉敏感参数；缓存命中与网络下载分开解释。跨域资源要服务器提供 `Timing-Allow-Origin` 才能开放受限的详细阶段时间，这与允许 fetch 读取内容的 CORS 不是同一个响应头。不能声称能精确看到所有第三方资源的内部耗时。参考 [Resource Timing](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming)。

### 17. 防止前端页面重复请求

**可以这样答：** 先区分防双击、共享同一读取、取消旧搜索和写入幂等。它们不是同一种去重。

读取可用“方法 + 规范化 URL/参数 + 用户/租户范围”做 key，在 pending Map 共享 Promise，finally 清理。搜索使用新请求替代旧请求，取消并做代次校验。写操作即使禁用按钮，也应由服务端幂等键防止重复执行。

**Moose 实例：** `usagePending` 合并同 provider 查询；`requestGeneration` 防止旧快照覆盖新结果。后者是防过期响应，不等于取消了请求。共享请求有多个订阅者时，一个组件卸载不应直接取消其他组件仍需要的底层请求。

### 18. ResizeObserver作用是什么

**可以这样答：** ResizeObserver 观察元素尺寸变化，适合编辑器容器、图表和动态消息高度。window resize 只知道窗口变化，无法覆盖侧栏展开、内容换行等导致的元素变化。

回调里使用提供的尺寸，避免不停“测量→改尺寸→再触发”；必要时把写操作放到下一帧并比较前后值，防止 resize loop。观察哪个 box、单位和 SVG 情况要明确，组件卸载时 disconnect。它不观察元素位置，位置变化另用布局或滚动信息。

### 19. 要实时统计用户浏览器窗口大小，该如何做

**可以这样答：** 一般布局用 CSS 媒体查询就够；业务确实需要数值时，监听 window resize 并按帧节流，读取 innerWidth/innerHeight。

移动端软键盘、缩放涉及可视视口，可用 `visualViewport` 的尺寸/事件并做兼容回退。组件真正关心自身大小时用 ResizeObserver，避免把所有变化都绑定到窗口。SSR 阶段没有 window，需要在客户端挂载后读取并清理监听。

### 20. 当项目报错，你想定位是哪个commit 引入的错误的时，该怎么做

**可以这样答：** 找一个确定正常的提交和一个确定异常的提交，用 `git bisect` 二分定位首次引入问题的提交。先写稳定复现步骤或测试，否则 good/bad 标记会误导搜索。

```bash
git bisect start
git bisect bad
git bisect good <已知正常提交>
# 在当前候选提交验证，然后执行 git bisect good 或 git bisect bad
# 结束后：
git bisect reset
```

可用 `git bisect run <脚本>` 自动判断，无法构建的候选可 skip。保持依赖与测试环境一致，不要把数据变化或外部服务波动误判成代码回归。参考 [Git bisect](https://git-scm.com/docs/git-bisect)。

### 21. 如何移除一个指定的commit

**可以这样答：** 已共享历史通常用 `git revert <commit>` 新增一个反向提交，保留审计；只在自己尚未共享的分支里，才用交互式 rebase 把指定提交 drop。

不能为了移除中间一条提交直接 reset 到它前面，否则后续提交也会从分支尖端消失。若后续代码依赖该提交，撤销仍可能冲突并需测试；合并提交 revert 还要明确 mainline。操作前建备份分支、保持工作区干净。本题不执行任何 Git 修改。

### 22. 如何还原用户操作流程

**可以这样答：** 先收集低成本 breadcrumbs：路由、点击的业务动作、关键状态转换、请求状态和错误，并用 sessionId/traceId 串起来。需要可视回放时再采集脱敏的 DOM 快照与变更，不一定是录屏视频。

密码、输入内容、附件等默认遮蔽，限制采样、保留时长和上传大小；记录 release、设备和配置才能复现同一环境。回放也有边界，Canvas、跨域 iframe 和外部系统状态未必能完整重建。

**Moose 实例：** 消息、工具、审批记录能还原代理执行时间线，但没有完整鼠标操作回放；SQLite 历史不能直接当成全用户会话录制。

### 23. 可有办法将请求的调用源码地址包括代码行数也上报上去？

**可以这样答：** 可以在统一请求封装的发起点采集 `new Error().stack`，把调用堆栈与 requestId 关联，服务端结合准确版本的 source map 还原原始文件和行列。

采集时机要在调用入口，等异步失败后再取 stack 可能只剩公共拦截器位置。堆栈格式因环境不同而异，打包和内联会影响定位，不能承诺总能精准还原；可以补充稳定的业务 operation 名。做采样与脱敏，避免每次请求都付出完整堆栈开销、暴露本机路径。

### 24. 请求失败会弹出一个toast,如何保证批量请求失败，只弹出一个toast

**可以这样答：** 网络层统一归类错误，提示层按错误 key 或批次 ID 聚合，短时间内相同错误只显示一个；每个请求仍保留自己的失败结果与日志。

```js
const shown = new Map();
function notifyOnce(key, message, toast) {
  const now = Date.now();
  for (const [k, time] of shown) if (now - time > 2000) shown.delete(k);
  if (shown.has(key)) return;
  shown.set(key, now);
  toast(message);
}
```

这是**两秒窗口的教学示例**，不是所有错误一律两秒内忽略。并行请求属于同一业务批次时，用 `allSettled` 汇总为“部分加载失败”；鉴权过期统一走登录流程，用户取消不弹失败提示。避免组件和公共层各弹一次。

### 25. 如何减少项目里面if-else

**可以这样答：** 先看分支表达的是映射、互斥流程还是复杂规则。固定映射用对象表，复杂流程用命名函数/策略，异常条件用提前返回降低嵌套。

```ts
const labels = { running: '执行中', waiting: '等待确认', failed: '失败' };
```

不要为了消除每个 if 把简单逻辑拆成难追踪的类或配置。互斥有限状态的 switch 很直观，还方便做穷尽检查。**Moose** 把 provider 差异放 Adapter 是有意义的抽象；Service 中不同 IPC 用例的 switch 本身不等于坏设计，关键看每个分支是否有清晰职责。

### 26. babel-runtime 作用是啥

**可以这样答：** Babel 转译某些语法需要辅助函数；如果每个文件都内联同一套 helper，会重复增加体积。`@babel/plugin-transform-runtime` 可以把 helper 改为导入 `@babel/runtime` 中的共享实现。

runtime 是运行时依赖，插件是构建时工具。它不是自动补齐全部新浏览器 API 的万能 polyfill；Promise、实例方法等兼容处理要看所用 Babel 版本和 polyfill 配置，不要照搬旧版 core-js 选项。参考 [Babel transform-runtime](https://babeljs.io/docs/babel-plugin-transform-runtime)。

**Moose 边界：** 当前没有手工配置这套 runtime 流程，不把 Vite 项目自动等同于手写 Babel 转译实践。

### 27. 如何实现预览PDF文件

**可以这样答：** 简单预览可用浏览器 PDF 查看器，以 iframe/object 打开可信 PDF 地址；需要分页、缩放、搜索、文本选择等一致体验时，可集成 PDF.js。

大文件按需加载页面，渲染可见页与附近页面并释放远处 Canvas；带鉴权的文件可通过受控请求取得 Blob 后生成 object URL，关闭时 revoke。注意 CORS、Range 支持、字体和扫描件没有可选文字的问题，预览失败提供下载。

**Moose 边界：** 附件功能不代表已集成完整 PDF 阅读器，本题按一般浏览器方案回答。

### 28. 如何在划词选择的文本上添加右键菜单（划词：鼠标滑动选择一组字符，对组字符进行操作）

**可以这样答：** 在目标容器监听 contextmenu，读取 Selection，确认选择非空且 Range 的两端都在容器内，然后阻止默认菜单并显示自己的菜单。

保存选中文本与 Range 副本，因为点击菜单可能使 selection 消失；坐标使用鼠标 clientX/clientY 或 Range 矩形，并限制在视口内。菜单操作后关闭，支持 Escape 和键盘入口，不在密码等敏感字段做采集。

内容改变后旧 Range 可能失效，涉及持久标注时应转成文档模型中的位置，而不是长时间保存 DOM 节点引用。

### 29. 富文本里面，是如何做到划词的(鼠标滑动选择一组字符，对组字符进行操作)？

**可以这样答：** 浏览器原生划词由 Selection 和 Range 表示：起止节点加各自偏移，可以跨多个文本节点。富文本编辑器再把 DOM 选区映射到自己的文档位置。

加粗或评论应通过编辑器 transaction 修改模型，更新选区并进入撤销历史；不要直接给复杂 contenteditable 拼 innerHTML。持久标注记录节点/文本位置和上下文，文档被别人或 AI 改动后需要重定位。工具栏点击导致焦点变化时先保存编辑器 selection，再执行命令。

### 30. 如何做好前端监控方案

**可以这样答：** 我会从“发现、定位、验证修复”三个环节设计：采集 JS/Promise/资源错误、请求失败与耗时、关键页面性能、业务失败；统一用版本、用户匿名标识和 traceId 关联。

客户端做脱敏、采样、批量上报与失败补报，服务端聚合相同错误、看影响人数和趋势，再设置有行动价值的告警。source map、breadcrumbs、必要的回放帮助复现；发布后比较错误率和核心体验指标，确认修复。

**经历边界：** 可以说明轻度使用过 Sentry，不宣称搭建过全站监控平台。Moose 当前是本地错误提示与持久化历史，完整远程监控属于后续方案。

### 31. 如何标准化处理线上用户反馈的问题

**可以这样答：** 反馈入口自动带版本、时间、系统和关联任务 ID，用户只补操作步骤、预期/实际和可选截图。敏感日志由用户确认后提供，先脱敏。

处理流程是分类定级 → 去重归并 → 关联日志与发布 → 最小复现 → 指定负责人 → 修复测试 → 发布验证 → 回告用户。无法复现时记录缺失信息，别用“本机正常”直接关闭。

**Moose 实例：** 问题至少区分 Renderer、runtime 和 provider CLI，记录 CLI 版本、provider、权限模式与 runId；网络/登录错误和客户端渲染错误不能混到一张笼统工单里。

### 32. px 如何转为rem

**可以这样答：** rem 相对于根元素字体大小，换算公式是 `rem = px / 根字号`。例如根字号 16px，24px 就是 1.5rem。

不要为了方便无条件把根字号跟屏宽无限放大；文本应尊重用户字号偏好，布局可以用 flex/grid、百分比和 clamp。已有 px 可以通过构建插件转换，但要约定哪些不转换，例如细边框和第三方组件，统一设计基准。

### 33. 浏览器有同源策略，但是为何cdn请求资源的时候不会有跨域限制

**可以这样答：** 同源策略主要限制跨源读取，并非禁止所有跨源资源加载。经典 script、图片、样式等有各自的嵌入规则，所以能从 CDN 加载；fetch 读取跨域响应则需要 CORS。

模块脚本、字体、Canvas 像素读取等又有更具体限制，CSP/CORP/COEP 也可能阻止加载。图片能显示不代表 JS 能读取它的像素，CDN 资源能显示也不代表能读取完整资源计时。不要回答成“CDN 不受同源策略限制”。

### 34. cookie可以实现不同域共享吗

**可以这样答：** 共同父域下的子域可以通过合法 Domain 范围共享 Cookie，例如 a.example.com 与 b.example.com 可使用 `Domain=example.com`；默认不设 Domain 是 host-only。

完全无关的域不能直接共享同一个 Cookie，也不能把 Domain 设为公共后缀。跨站登录通常通过统一身份服务重定向交换一次性凭证，再各自建立会话。SameSite、Secure 和浏览器第三方 Cookie 策略仍会影响发送；跨源 fetch 还需正确 credentials/CORS 配置。参考 [Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)。

### 35. axios是否可以取消请求

**可以这样答：** 可以，现代 Axios 支持 AbortController 的 signal。

```js
const controller = new AbortController();
axios.get('/search', { params: { q: 'react' }, signal: controller.signal });
controller.abort();
```

取消后区分取消错误与真正网络失败，不显示普通失败 toast。旧 CancelToken 方案已不推荐新用。取消客户端请求不证明服务器没有执行写入，写操作仍需幂等和服务端取消设计。参考 [Axios 官方仓库取消说明](https://github.com/axios/axios#cancellation)。

### 36. 前端如何实现折叠面板效果？

**可以这样答：** 简单折叠优先原生 details/summary，自带键盘和基本语义；需要受控展开或手风琴时，用按钮配 `aria-expanded/aria-controls` 管状态。

动画可使用实际测量高度或 grid 行从 0fr 到 1fr，内部加 overflow hidden，减少动画偏好下关闭过渡。收起内容要避免仍可 Tab 聚焦，多个面板用稳定 ID。

**Moose 实例：** 工具与思考记录使用 details/summary，既保持主对话简洁，又能按需看执行细节。见 [Transcript](../../src/components/transcript.tsx)。

### 37. dom里面，如何判定a元素是否是b元素的子元素

**可以这样答：** `b.contains(a)` 可以判断 a 是否在 b 的后代树中，但 a 与 b 相同也返回 true；要求严格子孙关系时再排除自身。

```js
const isDescendant = a !== b && b.contains(a);
const isDirectChild = a.parentElement === b;
```

直接子元素和任意深度后代要分清。Shadow DOM 的边界与普通 DOM 树不同，事件场景可能更适合查看 composedPath，不能假定 contains 跨所有影子边界。

### 38. 判断一个对象是否为空，包含了其原型链上是否有自定义数据或者方法。该如何判定？

**可以这样答：** 先约定检查范围：自有属性和自定义原型上的属性都算，但 Object.prototype 的内置方法不算。用 Reflect.ownKeys 能包含不可枚举属性和 Symbol，再逐级检查原型。

```js
function emptyThroughPrototype(value) {
  if (value === null || typeof value !== 'object') return false;
  for (let p = value; p !== null && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    const keys = Reflect.ownKeys(p).filter((k) => !(p !== value && k === 'constructor'));
    if (keys.length) return false;
  }
  return true;
}
```

这是约定用于普通对象/自定义类的教学实现，忽略类原型默认 constructor，不代表 Map/Set/Date 的语义判空；Proxy、跨 realm 和被修改的 Object.prototype 也需另定规则。只检查属性名、不读取属性值，可以避免主动调用 getter。

### 39. is如何判空？「空」包含了：空数组、空对象、空字符串、0、undefined，null、空map、空set,都属于为空的数据

**可以这样答：** 按题目给定业务口径显式判断，不能直接 `!value`，否则 false、NaN 等也会被混进去。题目里的 `0.undefined` 按 0 和 undefined 两种值理解。

```js
function isEmpty(value) {
  if (value === null || value === undefined || value === 0 || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (value instanceof Map || value instanceof Set) return value.size === 0;
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    return (proto === Object.prototype || proto === null) && Reflect.ownKeys(value).length === 0;
  }
  return false;
}
```

这里空白字符串、false、NaN 不算空，Date 不按空对象处理；0n 和跨 iframe 对象如果也要支持，另补明确规则。通用工具最怕含糊的“空”，先说口径再写代码。

### 40. css实现翻牌效果

**可以这样答：** 外层设置 perspective，内层保留 3D，两面绝对定位并隐藏背面，翻转时旋转整个内层。

```css
.card {
  perspective: 1000px;
}
.inner {
  position: relative;
  transform-style: preserve-3d;
  transition: transform 0.4s;
}
.card[data-flipped='true'] .inner {
  transform: rotateY(180deg);
}
.front,
.back {
  backface-visibility: hidden;
}
.back {
  position: absolute;
  inset: 0;
  transform: rotateY(180deg);
}
@media (prefers-reduced-motion: reduce) {
  .inner {
    transition: none;
  }
}
```

触屏用点击/按钮而非只靠 hover；不可见那一面同时处理焦点和无障碍，CSS 隐藏背面本身不等于从辅助技术中隐藏内容。

### 41. flex:1代表什么

**可以这样答：** 浏览器中 `flex: 1` 通常展开为 `flex: 1 1 0%`：可增长、可收缩、基础尺寸按 0% 参与剩余空间分配。

它不是“宽度等于父容器”。多个 flex:1 项通常均分可分配空间，但内容最小尺寸、padding、gap 等仍会影响最终宽度。长文本不肯缩小时常需要 `min-width: 0`；纵向 flex 滚动容器则经常需要 `min-height: 0`。Moose 的消息滚动容器就使用 min-h-0 防止内容把布局撑开。

### 42. 一般是怎么做代码重构的

**可以这样答：** 先确认要改善什么，例如协议分支扩散或函数难测；固定现有行为，再小步调整结构，每步跑相关测试。重构尽量不同时改变业务规则和大面积格式。

从重复变化点提取边界，命名清楚，删掉真正无用的层；对外接口先保持兼容，必要时逐步迁移。用差异、复杂度和测试反馈评估结果，不以文件变多或设计模式变多当成果。

**Moose 实例：** 新 provider 应放在 Adapter 层，不在 UI 到处加分支；对 `Service` 的复杂用例可先提取可独立验证的调度/历史处理逻辑，但也不必把每个 switch case 拆成单独类。

### 43. 如何清理源码里面没有被引用的代码，主要是JS、TS、CSS代码

**可以这样答：** 先用类型/静态分析工具找未使用导出、文件、依赖，再结合入口、动态 import、路由、插件注册和测试确认。CSS 要结合真实页面覆盖率与动态 class 规则，静态没搜到不一定没使用。

分批删除并跑构建、测试、关键页面检查；覆盖率只代表测过的场景，不能直接据此删除全部未覆盖代码。生成协议、外部 API 导出和运行时约定文件尤其谨慎。

**Moose 实例：** 国际化词条中出现某功能文案，也不证明该入口真实存在；反过来动态引用的资源不一定能被普通文本搜索发现。只读确认调用链后再删。

### 44. 前端应用如何做国际化？

**可以这样答：** UI 文案用稳定 key，语言包与业务逻辑分离；数量、日期、货币使用 Intl 和复数规则，避免拼接句子导致语序错误。语言选择可手动覆盖系统值，缺失 key 有回退和检查。

还要考虑长文本撑布局、RTL、排序、输入法与无障碍。日期显示应明确时区，不能只把英文词换成中文。

**Moose 实例：** `src/lib/i18n.tsx` 有中英文词典、TranslationKey 与 LocaleContext，设置支持 system/en/zh-CN。可以讲成轻量字典式国际化；部分时间显示使用固定 `en-GB`，不能说所有格式都已随语言全面本地化。

### 45. 应用如何做应用灰度发布

**可以这样答：** 用稳定用户分桶或指定群体先开放小比例流量，观察错误率、性能和业务指标，再逐步扩大。资源版本与功能开关分开管理，开关可快速关闭，产物可回滚。

新旧前后端需要兼容，数据迁移尽量先扩展再收缩；回滚代码不一定能回滚已写数据。不能每次刷新都随机分组，否则用户体验和监控都会混乱。

**Moose 边界：** 当前本地 DMG 分发，没有自动更新/灰度平台。若设计桌面灰度，应有稳定更新通道、版本签名和兼容存储迁移，而不是照搬网页百分比路由。

### 46. [微前端]为何通常在微前端应用隔离，不选择iframe方案

**可以这样答：** iframe 隔离强、实现直接，但子应用路由、滚动、弹层、尺寸、登录和无障碍整合更费力，跨文档通信也需要明确协议。希望子应用像一个页面时，团队常选择其他微前端方案。

iframe 并不是落后方案：不可信第三方或隔离要求高时很有价值，配合 sandbox、权限策略和 postMessage 校验。取舍依据是隔离强度和体验整合成本，不是“微前端一定不能用 iframe”。Moose 当前不采用这种架构。

### 47. [微前端]Qiankun是如何做JS隔离的

**可以这样答：** 典型 Qiankun JS 沙箱通过 Proxy 包装 window，把子应用对全局变量的读写导向受控对象；兼容路径也有通过记录/恢复全局差异的快照思路。挂载与卸载时还处理部分监听、定时器等副作用。

它属于同一 JS 环境里的隔离，不能等同浏览器进程/安全沙箱。DOM、样式、共享对象和逃逸路径需要额外治理，具体覆盖范围依版本而定；不要说 Proxy 能隔离所有副作用。官方对隔离和沙箱边界的说明见 [Qiankun FAQ](https://qiankun.umijs.org/faq/)。

### 48. [微前端]微前端架构一般是如何做JavaScript隔离

**可以这样答：** 先分命名隔离、运行上下文隔离和安全隔离。ES Modules/闭包减少全局命名冲突，Proxy 沙箱拦截一部分全局访问，iframe 提供独立 window/document，Worker 提供独立执行环境但不能直接渲染 DOM。

子应用还需清理监听、计时器与订阅；CSS 作用域和 Shadow DOM 处理的是样式/DOM 封装，不自动隔离全部 JS。对不可信代码不能只依赖变量代理。根据是否需要强隔离、DOM 共享和通信成本选择方案。

### 49. [React]循环渲染中为什么推荐不用index 做key

**可以这样答：** key 帮 React 判断同级列表里哪个元素是同一个。index 在插入、删除、重排时对应关系会变，组件内部状态可能跟着位置走，输入值或展开状态就串到另一条记录上。

用稳定业务 ID，同一记录更新时 key 不变。随机数 key 也不行，会每次重建；列表永不变化且无内部状态时 index 才可能够用。

**Moose 实例：** 时间线用 `message.id`，流式更新修改 seq/text，不改消息身份。顶部加载旧历史若用 index，会让已有消息全部换“位置身份”。见 [Transcript](../../src/components/transcript.tsx)。

### 50. [React]如何避免使用context 的时候，引起整个挂载节点树的重新渲染

**可以这样答：** Context value 变化会更新读取它的消费者，不是机械地让整棵树每个节点都因 Context 订阅而更新。先把高频数据和低频配置分开，Provider 放到合理范围，稳定对象/函数引用。

多个独立需求拆 Context，状态与 actions 也可分开；高频细粒度状态可采用支持 selector 的外部 store。memo 无法挡住组件自己订阅的 Context 值变化。参考 [React memo 与 Context](https://react.dev/reference/react/memo)。

**Moose 实例：** LocaleContext 只存语言字符串，切语言让文案消费者更新是预期行为；不应把每次流式正文也塞进同一个语言 Context。

### 51. 前端如何实现截图？

**可以这样答：** 先确认要截 DOM、当前屏幕还是整个页面。DOM 转 Canvas 的库是根据 DOM/样式重绘，可能与浏览器真实截图不完全一致；屏幕捕获需用户授权，自动化完整页面截图则由浏览器测试工具执行。

跨域图片、字体、Canvas、iframe 和超大尺寸都可能限制结果。导出前隐藏敏感内容，必要时分片拼接并限制分辨率。

**Moose 场景：** Electron 可以通过可信后台提供窗口捕获能力，但不能因此说当前已有该功能；现有 Playwright E2E 环境可用于测试截图，两者是不同用途。

### 52. 当QPS达到峰值时，该如何处理？

**可以这样答：** 先定位峰值来源和瓶颈，再做限流、削峰、缓存和降级。后端按用户/租户配额限流，队列控制模型并发，超限返回可理解的错误和重试信息；必要时扩容，但扩容不是无限的。

前端减少重复读取、限制并发、按退避和随机抖动重试，保留用户输入并展示排队，不能让所有客户端同一秒重试。高优先级交互优先，非必要刷新暂缓。

**Moose 类比：** 目录互斥是本地资源竞争控制，不是互联网 QPS 限流；额度查询缓存/合并则确实减少重复调用。

### 53. js超过Number 最大值的数怎么处理？

**可以这样答：** 先区分最大可表示值和最大安全整数。整数超过 `Number.MAX_SAFE_INTEGER` 后可能失去精度；更大的浮点数仍可表示，但不能保证整数逐一精确。

整数用 BigInt，并从字符串创建，例如 `BigInt('9007199254740993')`；不要先转成 Number 再转 BigInt，精度可能已经丢了。BigInt 不能直接和 Number 混算，JSON 默认也不能直接序列化，需要按字符串传输。

高精度小数用十进制定点整数或十进制库；用户 ID 这类不用算术的字段直接保持字符串最稳。

### 54. 使用同一个链接，如何实现PC 打开是web应用、手机打开是一个 H5应用？

**可以这样答：** 同一 URL 最简单是响应式页面，按视口改变布局。如果 PC 和手机是两套独立应用，可由服务端根据设备提示选择入口或重定向，前端仍保留用户切换入口。

UA/Client Hints 只是辅助，平板和桌面模式要有兜底；CDN 缓存要区分正确的设备变体，避免把手机版 HTML 缓给桌面。分享链接和业务路由保持一致，别让跳转丢参数或形成循环。不要只依赖前端跳转导致先下载两套资源。

### 55. 如何保证用户的使用体验

**可以这样答：** 先保证关键任务能完成，再看速度、反馈、容错与可访问性。用户操作后马上看到状态，长任务可取消，失败保留输入并可重试，加载时不让布局乱跳，键盘和读屏也能操作。

用真实设备和关键路径测试，再用延迟、错误率、任务完成率与反馈验证体验，不能只凭动画流畅就说好用。

**Moose 实例：** 排队可见、审批单独展示、历史本地保存、停止后暂停后续任务、长会话按页加载、Git diff 可审阅，都是围绕“知道在做什么、能控制、能恢复”。是否达到性能目标仍需测量，源码机制本身不等于指标结果。

### 56. 如何解决页面请求接口大规模并发问题

**可以这样答：** 统一做有界并发，而不是对几百项直接 Promise.all。队列区分关键/次要请求，滚出视口或切换页面后取消不再需要的工作，重复读取共享请求。

```js
async function mapLimit(items, limit, run) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('limit 必须为正整数');
  let next = 0;
  const results = new Array(items.length);
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        try {
          results[i] = { status: 'fulfilled', value: await run(items[i], i) };
        } catch (reason) {
          results[i] = { status: 'rejected', reason };
        }
      }
    }),
  );
  return results;
}
```

示例保留输入顺序且收集单项失败；生产补充 AbortSignal、优先级、重试上限。前端并发限制不代替服务端限流，429 应按服务端指示等待并加抖动。

### 57. 设计一套全站请求耗时统计工具

**可以这样答：** 统一封装 fetch/Axios，在发起前记录单调时钟，在响应/失败/取消时结算；记录 method、规范化路由、状态、耗时、requestId、页面和发布版本。

计时口径要明确：fetch resolve 通常只代表响应头到达，不代表流式 body 读完。因此分别统计 headers、首个有效内容和流结束；HTTP 4xx/5xx 的 fetch 也会正常 resolve，要检查 response.ok。finally 中保证记录一次，排除埋点自己的请求。

资源下载阶段通过 Resource Timing 补充，后端通过 traceId/Server-Timing 辅助拆解。**Moose** 应分别测 IPC 往返与代理生成耗时，不能把发送入队接口返回当成整次模型完成。

### 58. 大文件上传了解多少

**可以这样答：** 完整大文件上传包括：校验文件 → 获取 uploadId → 分片与有界并发上传 → 查询已完成片段 → 重传缺失片段 → 服务端校验并原子合并 → 清理临时片段。

每片带 uploadId/index/校验信息，服务端保证重复上传幂等；暂停取消在途请求，恢复读取服务器确认的已上传集合。文件哈希可在 Worker 增量计算，不把大文件一次读进内存。进度以已确认字节加合理的在途字节估算，完成后仍等合并确认。

安全上限制大小、类型、配额和会话过期，不能仅凭客户端文件名/哈希授权下载他人文件。**Moose** 当前复制附件到本地受控目录，单文件 20MB 上限，不是网络分片上传系统。

### 59. H5如何解决移动端适配问题

**可以这样答：** viewport 配置加响应式布局，以 flex/grid、百分比和媒体/容器查询处理结构，字号和间距按需求使用 rem/clamp，图片给 max-width。不要把所有页面强行按一张设计稿等比缩放。

处理 safe-area、触控目标、软键盘、横竖屏、动态视口高度和长文本；保持用户缩放能力。至少在 iOS Safari 与 Android 浏览器验证滚动、固定定位和输入框。CSS px 是逻辑像素，DPR 不意味着要把所有尺寸乘设备像素比。

### 60. 站点一键换肤的实现方式有哪些？

**可以这样答：** 常用方案是语义化 CSS 变量，根节点切换 class/data-theme，组件统一引用背景、前景、边框、强调色等 token。用户选择持久化，system 模式监听 prefers-color-scheme。

初始加载尽早应用主题避免闪白，图表/图片/原生控件也要同步；不要通过整页 filter 反色冒充深色主题。保留对比度、焦点状态和减少动画偏好。

**Moose 实例：** 设置有 system/light/dark，`app.tsx` 根据设置和后台系统外观切换根节点 dark 类。后台外观事件触发快照更新，适合说明“系统变化 + 用户覆盖”的优先级。

### 61. 如何实现网页加载进度条？

**可以这样答：** 浏览器没有一个能准确代表“全站加载完成百分比”的统一 API。页面初载、路由加载、文件下载和 AI 生成要分别定义进度。

路由进度条可以开始后逐渐推进，到关键内容完成才结束，明确是状态指示；已知 Content-Length 的下载才按字节算真实比例，也要考虑压缩与流式响应。并行请求用引用计数或任务组，防止第一个请求结束就把进度条关掉。

AI 未知总 token 时不伪造精确百分比；Moose 的 running/waiting 状态比错误的“已完成 90%”更可信。

### 62. 常见图片懒加载方式有哪些？

**可以这样答：** 普通图片优先 `loading="lazy"`，需要控制预加载距离和复杂状态时用 IntersectionObserver；轮播或组件也可在接近可见时才设置 src。

图片预留尺寸，提供 srcset/sizes 或合适格式，加载失败有替代内容。首屏关键大图通常不应懒加载，否则可能拖慢 LCP。传统 scroll 监听方案可以用但要节流并避免频繁布局读取。懒加载减少初始资源，不等于压缩图片体积。

### 63. cookie构成部分有哪些

**可以这样答：** Set-Cookie 中先是 name=value，常见属性包括 Domain、Path、Expires/Max-Age、Secure、HttpOnly、SameSite；按需要还有 Partitioned 等属性。

Domain/Path 控制发送范围，过期属性控制寿命，Secure 限定安全传输，HttpOnly 阻止脚本读取，SameSite 约束部分跨站发送。HttpOnly 不能阻止浏览器自动携带 Cookie，Path 也不是安全隔离边界。

响应设置属性，后续请求的 Cookie 头通常只携带 name=value 对，不把整套属性都带回。参考 [Set-Cookie 属性](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)。

### 64. 扫码登录实现方式

**可以这样答：** PC 向服务端申请短期一次性二维码会话，二维码携带不可预测的标识；手机登录用户扫码后先看到登录设备/地点并确认，服务端再把该二维码状态改为已授权。

PC 通过轮询、SSE 或 WebSocket 得知结果，用绑定当前浏览器会话的凭证完成登录。二维码设置短有效期、单次消费、防重放，手机取消或过期后 PC 更新状态。不能把长期登录 token 直接放二维码，也不能仅扫码不确认就自动授权，避免被诱导登录。

Moose 复用 CLI 登录状态，当前没有扫码登录流程。

### 65. DNS协议了解多少

**可以这样答：** DNS 把域名解析为记录，例如 A/AAAA 指向 IP，CNAME 指向另一个域名。浏览器和系统先查缓存，递归解析器再按需要查询根、顶级域和权威服务器，并按 TTL 缓存。

DNS 解析不包含页面路径，也不是 HTTP 请求本身；拿到地址后还需建立传输和 TLS/HTTP 连接。传统 DNS 可用 UDP/TCP，另有 DoH/DoT；CDN 可根据解析来源和策略返回合适节点，但不能承诺一定是用户物理距离最近的机器。TTL 与多层缓存意味着切换记录不一定立即全量生效。

### 66. 函数式编程了解多少？

**可以这样答：** 函数式编程强调用纯函数组合数据转换，把副作用集中在边界。纯函数对同样输入返回同样结果，不修改外部状态，更容易测试和复用。

例如消息合并逻辑输入 old/incoming 返回新数组，网络、落库和订阅放外层；通过 map/filter/reduce 组织转换，但不意味着必须把每个 for 循环改成 reduce。不可变更新只复制变化路径，避免为了“纯”而全量深拷贝。

**Moose 实例：** `mergeMessages` 是适合独立测试的转换函数；Service 接收事件、存库和发布属于副作用边界。项目不是纯函数式架构，也不需要这样包装。

### 67. 前端水印了解多少？

**可以这样答：** 明水印可用 Canvas/SVG 生成平铺背景或覆盖层，带用户标识和时间，设置 pointer-events:none 不挡交互。导出的图片/PDF 可在生成环节把水印写进内容。

DOM 水印能被开发者工具移除，MutationObserver 最多增加移除成本，不构成安全防线；截图、裁剪也可能绕过。需要追责时结合服务端生成、访问审计与权限控制。水印内容避免泄露过多个人信息，暗水印是另一套取证技术，不能说普通遮罩能绝对防泄漏。

### 68. 什么是领域模型

**可以这样答：** 领域模型就是用业务概念、关系和规则描述系统，而不是先从页面控件或数据库字段出发。实体有持续身份，值对象表达不依赖身份的值，聚合划定需要一致性维护的范围。

**Moose 可直接展开：** Project 是本地目录，Session 是该目录下绑定 provider 的对话，Message 是某轮的用户/文本/工具记录，QueueItem 是还没执行的输入。nativeId 关联代理会话，runId 关联一次执行；“一个会话能多轮，一轮能多条记录”是理解数据关系的关键。

规则比名词更重要：同一目录在 Moose 内只运行一个任务，审批只接受当前 pending 请求，编辑只能改空闲会话最新用户消息。领域模型不必用复杂类实现；当前这些规则主要在 Service/Store，可以说“按业务建模”，不要夸成完备 DDD 框架。

## 源码核对入口

项目实例以本次读取的实现为准，优先查看以下文件。文中的方案题不表示这些能力已落地。

| 文件                                                                             | 适合核对的主题                                 |
| -------------------------------------------------------------------------------- | ---------------------------------------------- |
| [shared/types.ts](../../shared/types.ts)                                               | 泛型 IPC、Session/Message/Status、用量类型     |
| [shared/validation.ts](../../shared/validation.ts)                                     | Zod 运行时校验与输入边界                       |
| [electron/service.ts](../../electron/service.ts)                                       | 排队、目录互斥、流式合并、取消、编辑、用量缓存 |
| [electron/db/store.ts](../../electron/db/store.ts)                                     | SQLite 事务、消息版本、分页、启动恢复          |
| [electron/providers/types.ts](../../electron/providers/types.ts)                       | AgentAdapter、统一事件与能力差异               |
| [electron/providers/rpc.ts](../../electron/providers/rpc.ts)                           | stdio 拆包、请求 ID、超时和连接关闭            |
| [electron/runtime-host.ts](../../electron/runtime-host.ts)                             | utility process 生命周期与请求关联             |
| [electron/preload.ts](../../electron/preload.ts)                                       | Renderer 的受限桥接接口                        |
| [electron/main.ts](../../electron/main.ts)                                             | 窗口、IPC 来源校验与安全设置                   |
| [src/lib/workspace.ts](../../src/lib/workspace.ts)                                     | 快照、请求代次、消息合并                       |
| [src/components/transcript.tsx](../../src/components/transcript.tsx)                   | Markdown、memo、工具折叠和完整回答复制         |
| [src/components/ui/message-scroller.tsx](../../src/components/ui/message-scroller.tsx) | 滚动容器与 content-visibility                  |
| [src/lib/i18n.tsx](../../src/lib/i18n.tsx) / [src/app.tsx](../../src/app.tsx)                | 国际化、主题、会话搜索                         |
| [vite.config.ts](../../vite.config.ts) / [package.json](../../package.json)                  | 构建入口、脚本、依赖和打包范围                 |

复习时优先串起“一条消息从发送到完成”的链路，再练类型、流式、状态、性能四部分；其余未实践过的方案用“我会这样设计”作答。涉及 Sentry 时按轻度使用经验表达即可。
