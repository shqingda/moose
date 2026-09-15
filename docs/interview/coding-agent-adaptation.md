# 面试题：Moose 如何适配不同的 Coding Agent？

**面试官**：Moose 同时接入 Codex、Grok Build 和 Pi。它们接口不同，一条消息怎么从 Moose 发给代理，再显示回同一套界面？

**可以这样答**：我没有在 Moose 里实现模型，而是调用用户本机安装的 CLI。用户发送消息后，Moose 先把它存入任务队列，再根据会话选中的代理启动对应适配器。适配器负责用代理自己的接口发消息、接收回复和工具事件；收到事件后转成 Moose 统一的消息格式。这样会话界面只处理“回答、工具、提问、审批”等内容，不需要理解三种协议。[发送与调度](../../electron/service.ts)、[适配器接口](../../electron/providers/types.ts)、[代理注册](../../electron/providers/registry.ts)。

**三个代理具体怎么通信？** 启动模式是“CLI 怎样让程序调用”，协议是“双方传什么格式的消息”，不要把两者混为一谈。

| 代理 | Moose 启动什么 | 怎样收发消息 | 会话怎样继续 |
| --- | --- | --- | --- |
| Codex | `codex app-server` | stdio JSON-RPC：请求 ID 对应回复，通知报告进度 | `thread/start` / `thread/resume`；`turn/start` 发起本轮 |
| Grok Build | `agent … stdio` | ACP SDK：连接后接收会话更新、工具和权限请求 | `newSession` / `loadSession`；`prompt` 发消息 |
| Pi | `pi --mode rpc` | Pi 的 JSONL RPC：每行一条命令、回复或事件 | 保存 `sessionFile`，下次用 `--session` 恢复；`prompt` 发消息 |

Codex 的 [JSON-RPC 收发层](../../electron/providers/rpc.ts)负责写入请求、匹配回复和分发通知；[Codex 适配器](../../electron/providers/codex.ts)处理它的会话、工具事件与审批。Grok 的 [适配器](../../electron/providers/grok.ts)通过 ACP SDK 接收流式消息和权限请求。Pi 的 [适配器](../../electron/providers/pi.ts)复用按行收发、请求匹配和进程清理代码，但用 `piCodec` 转换消息信封；**Pi RPC 不是 Codex 的 JSON-RPC**。

**Moose 怎么显示工具执行和回答？** 工具由代理执行，Moose 接收“开始、输出、结束”等事件。三个适配器分别把各自的原始事件转成 `AgentEvent`：文字增量成为回答消息，命令或工具调用成为活动记录，需用户决定的请求成为卡片。后台用事件 key 把同一段增量合在一起；最终完整文字覆盖此前的增量，避免回答重复。消息保存后推给界面，界面按统一类型渲染。[Codex 事件转换](../../electron/providers/codex.ts)、[Grok 事件转换](../../electron/providers/grok.ts)、[Pi 事件转换](../../electron/providers/pi.ts)、[消息合并与推送](../../electron/service.ts)、[界面呈现](../../src/components/transcript.tsx)。

**能力差异怎么处理？** 适配器探测模型和输入能力，界面按实际支持开放选项。Codex 有原生自动审核与 Plan；Grok 当前提供普通审批和完全访问，图片取决于 ACP 能力声明；Pi 没有内置审批沙箱，只能选择完全访问，扩展发出的确认或提问可以显示为卡片。任务完成的信号也各不相同：Codex 看 `turn/completed`，Grok 等 `prompt` 返回，Pi 等 `agent_settled`。Moose 不用一个代理的规则去推断另外两个。[Codex](../../electron/providers/codex.ts)、[Grok](../../electron/providers/grok.ts)、[Pi](../../electron/providers/pi.ts)。

**回答边界**：一个会话固定一个代理，不能在三者之间迁移原生上下文；编辑最新消息不会回退代码工作区。真实 Codex 流程已有验收记录；Grok 的真实生成曾受额度限制；Pi 已验证真实 CLI 握手，但当前记录中尚未验收真实模型生成。协议 fixture 不能说成真实模型执行全部通过。[会话处理](../../electron/service.ts)、[验证范围](../testing.md)。
