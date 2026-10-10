# 三、状态：事件落到谁手里，关掉之后还剩什么

> 对应答案：[03-state-management.md](../03-state-management.md)，原题 1、2、5、6。

上一章决定了「这条消息的新版本是哪一份对象」。这一章接着问：谁订阅这份对象，关掉页面以后它还在不在，用户点了发送之后画面上该出现哪一种事实。

聊天页里的数据不是一种东西。输入框每个按键都变，设置几乎不变，消息被后台不停换版本。全塞进一个大对象，任何一个字段变化，读这个对象的组件都可能跟着渲染。

## 按谁要读、变得勤不勤来放

消息和生成任务是服务端事实，后台持续更新，放在共享 store 里，按 ID 存。用户设置很少变，很多地方要读，也共享，但和消息分开。输入框文字、弹窗开关只有这块界面关心，留在组件自己的 state 里。

按 ID 存，是为了更新一条时不去碰其他条的对象。组件用 selector 只订阅自己那一条。selector 就是从整个 store 里挑出一块的函数。挑出来的结果如果和上次是同一个引用，订阅者就不必重渲染。上一章的合并如果只替换变了的那条，这里的订阅才能被跳过。

```ts
const message = useChatStore((state) => state.messagesById[id]);
// 更新时只替换 messagesById[id]，其他消息保持原来的对象
```

能从已有数据算出来的值，不要再存一份。未读条数如果已经能从消息列表算出来，再存一个 `unreadCount`，每次增删都要手动同步，两份就会打架。

Zustand 和 Redux Toolkit 都是这种 store 的常见实现。它们解决的是跨组件共享，又不要所有组件绑在同一份大对象上。输入框不必为了这个目的进全局 store。每个按键都进全局消息库，订阅消息的列表会被输入拖着渲染。

## 能放进 store 的，也不一定能写进快照

快照要回答的是：关掉再打开，用户还能看到什么。它保存的是数据，不是正在跑的 JavaScript。

适合写进去的有数据版本、会话配置、消息和消息自己的版本、待发送队列、最后确认的游标、原生会话 ID。原生会话 ID 用来向底座续接它自己的会话。那是请底座按它的方式续上上下文，不是把本进程里的 Promise 冻住再解冻。

进行中的 Promise、网络连接、子进程绑在当时的内存和操作系统资源上，序列化不了。新进程要重新建立。界面重连、原生会话续接、活进程恢复，是三种能力。

写入时这几样记录要彼此一致。不能队列写进去了、对应消息没写进去。事务要保证的就是几条记录一起成功，或者一起不出现。

恢复时先读出已持久化的会话、消息、队列，校验，并按版本把旧格式迁过来。原来是 queued、running、waiting 的，标成 interrupted。旧队列先暂停，不要一启动就自动接着跑。页面再拉快照和消息。

```ts
const restoredStatus = ['queued', 'running', 'waiting'].includes(saved.status)
  ? 'interrupted'
  : saved.status;
```

标成中断，是因为你无法证明那次执行还活着。直接标回 running，页面会假装有一个已经不在的任务。

## 点了发送，马上能显示的只有已经发生的事

用户点发送之后，模型可能还在排队，或者在等审批。这时可以马上显示的，是请求已收下、已进入队列。还没生成的回答不能预画。失败或内容完全不同时，假文字得收回来，用户已经把它当成结果看过了。

所以顺序是：立刻显示「已提交」或「排队中」，后台确认后把这次请求关联到正式任务 ID，收到真实增量才开始画回答。失败时保留用户输入，让人自己决定要不要重试。

重试要避免同一件有副作用的事执行两次。切换会话之后，旧会话迟到的结果不能写进当前会话。这和上一章核对序号是同一类问题：迟到的数据要核对身份。

`send` 成功只走到「已经入队」。回答文本来自后面的事件。

## 这几段等待，React 19 能代管一部分

发送以前常常手写 `sending`、错误字符串、禁用按钮、失败后把列表改回去。React 19 把其中几段变成了内置行为。它管的是「等」和「先显示已知的那一句」，不管「伪造还没生成的回答」。所以上一节的界限还在。

Action 是放进 transition 的异步函数。执行期间 `isPending` 为真，可以在发送期间禁用按钮。`useActionState` 记住上一次的返回值和 `isPending`，可以显示「发送失败，请重试」。`useOptimistic` 在进行期间先显示临时状态，结束回到真实数据，适合让用户刚打的那句话先出现。`<form action={fn}>` 在提交时调用 Action，`useFormStatus` 读提交状态。

乐观更新适合结果你已经知道的事。AI 的回答无法预知，不能用它造一句假回复。

临时消息带上 `pending: true`，画成半透明或「发送中」。它只在 Action 进行期间存在。成功时真实列表到来，临时状态被换掉。失败时没有新数据，临时状态消失，界面上等于撤回。输入内容还要留在输入框或错误提示里，否则用户打的字一起没了。自动撤回只收回界面上的临时态，错误文案和重试入口仍要自己做。

```tsx
const [optimistic, addOptimistic] = useOptimistic(
  messages,
  (list, text: string) => [
    ...list,
    { id: 'temp', role: 'user', text, pending: true },
  ],
);

const [error, sendAction, isPending] = useActionState(
  async (_prev: string | null, form: FormData) => {
    const text = String(form.get('text'));
    addOptimistic(text);
    try {
      await api.send(text);
      return null;
    } catch {
      return '发送失败，请重试';
    }
  },
  null,
);
```

`useOptimistic` 的更新要发生在 Action 或 transition 里。在普通点击回调里直接调用，React 会警告，临时状态也不会按预期留住。上面的例子能成立，是因为 `useActionState` 的函数本身跑在 transition 里。

## Moose 里实际是这样

逐步写法见 [答案](../03-state-management.md)。不要把通用方案说成已经接上：

| 实际 | 不要说成 |
| --- | --- |
| `useWorkspace` 管快照，`useTranscript` 管当前消息，输入留在组件里 | 用了 Zustand 或 Redux |
| 快照不含全部消息。重启把 queued / running / waiting 标成 interrupted，旧队列先暂停 | 快照能复活进程 |
| `send` 只表示已经入队 | 发送成功等于模型做完了 |
| 依赖是 React 19.3.0，但没有 Actions、`useActionState`、`useOptimistic`、`useTransition` | 因为是 React 19 就用了这些 Hook |
| 手写 `sending`，失败留草稿；用户消息等队列写入后的快照出现 | 乐观地显示了还没生成的回答 |
