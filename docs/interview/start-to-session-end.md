# 面试题：Moose 从启动到一轮对话结束，代码怎么走？

**面试官问：** 打开 Moose，选一个项目，新建会话，输入文字并按回车。之后程序做了什么？

**可以这样答：**

> `electron/main.ts` 是启动入口，负责创建窗口和接收页面请求。React 页面通过 preload 与主进程通信；真正的数据库和任务执行放在独立的后台进程里。
>
> 用户选目录时，Moose 把目录记为项目。点击“新建会话”只是打开输入页，首次发送才创建会话。按回车后，文字先写入 SQLite 队列。后台检查项目目录是否空闲：空闲就启动对应的 Codex、Grok 或 Pi CLI；同一目录已有任务则等待。CLI 创建或恢复它自己的对话，处理输入并不断返回回复、工具和审批事件。Moose 把这些事件保存成统一消息，推给 React 展示。CLI 完成这一轮后，Moose 更新状态并释放目录占用；会话保留，用户还能继续问。

## 沿着代码看

以“在项目 `/Projects/shop` 中发送‘修复登录按钮’”为例：

| 用户操作 | 代码入口 | 发生的事 |
| --- | --- | --- |
| 打开应用 | [`electron/main.ts`](../../electron/main.ts) → [`electron/preload.ts`](../../electron/preload.ts) → [`src/main.tsx`](../../src/main.tsx) | 创建 Electron 窗口、暴露 `request/subscribe`、挂载 React。首次业务请求由 [`runtime-host.ts`](../../electron/runtime-host.ts) 启动后台；[`runtime.ts`](../../electron/runtime.ts) 打开 SQLite，创建 Store 和 Service。 |
| 选择项目目录 | [`App.addProject()`](../../src/app.tsx) → [`main.ts`](../../electron/main.ts) → [`Service.addProject()`](../../electron/service.ts) → [`Store.addProject()`](../../electron/db/store.ts) | 弹出系统目录选择器，规范化路径，复用或新增项目记录。 |
| 点击“新建会话” | [`App.newSession()`](../../src/app.tsx) | 切到空白输入页；此时还没有数据库会话。 |
| 输入并按回车 | [`Composer`](../../src/components/composer.tsx) → [`App.onSend()`](../../src/app.tsx) | 普通 Enter 发送，Shift+Enter 换行，输入法组合时不发送。首次发送创建 Moose 会话并保存选项，然后请求 `send`。 |
| 排队与开始 | [`Service.send/drain()`](../../electron/service.ts) → [`Store.enqueue/begin()`](../../electron/db/store.ts) | 输入先写入 SQLite 队列。`drain()` 同目录串行调度；开始时在事务中出队、保存用户消息、将状态改为 `running`。 |
| AI 执行和展示 | [`Service.execute/accept/flush()`](../../electron/service.ts) → [`AgentAdapter`](../../electron/providers/types.ts) → [`useTranscript()`](../../src/lib/workspace.ts) | adapter 将输入交给 provider CLI；Moose 合并、保存并推送返回事件；React 按消息 ID 和 `seq` 更新界面。审批和提问通过 `respond` 传回 adapter。 |
| 本轮结束 | [`Service.execute()`](../../electron/service.ts) | 关闭本轮 adapter，保存最终消息与状态，释放目录占用，再检查队列。正常完成是 `completed`；失败或停止分别是 `failed`、`cancelled`。 |

**provider 的区别，追问时再讲：** Codex 在 [`codex.ts`](../../electron/providers/codex.ts) 中通过 `thread/start` 或 `thread/resume` 后调用 `turn/start`；Grok 在 [`grok.ts`](../../electron/providers/grok.ts) 中通过 ACP `newSession` 或 `loadSession` 后调用 `prompt`；Pi 的路径在 [`pi.ts`](../../electron/providers/pi.ts)。Moose 的 `drain()` 只调度任务，推理和工具执行循环由 CLI 负责。

**别说错：** `send` 返回成功只代表已入队；`completed` 只代表这一轮结束，不代表会话被删除。下次在同一会话发送，会产生新的一轮，并尝试恢复 provider 的原生对话。
