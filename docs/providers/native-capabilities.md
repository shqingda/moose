# 原生能力、Moose 接入与当前缺口

核查日期：2026-09-18 至 2026-09-19。下表描述 0.8.1 源码与本次验证；安装包验收见对应发布记录。

## 子代理

0.8.1 已移除输入框的子代理开关及额外委派提示。Codex、Grok 根据任务、原生工具和自身配置决定是否使用子代理，Moose 默认接收和展示相应活动，并转接受支持的审批；不另建调度器，也不强制每轮创建子任务。底座明确禁用的功能仍由底座配置决定。旧草稿中的 subagents 字段仅为兼容保留，不再影响请求。0.8.0 及更早安装包仍包含原开关。

Codex 的 `collabAgentToolCall`、`subAgentActivity` 转成可展开的活动记录，展示任务、底座提供的模型、代理 ID、状态与结果。工具调用已返回与子任务已完成分开表示。已识别子线程的审批转交现有审批界面；子线程完成通知不会结束主任务。

Grok 使用原生 ACP 运行委派，活动按 CLI 的工具标题展示，结果支持 `content` 和 `rawOutput`。当前未假设 Grok 提供 Codex 同款结构化子线程列表，因此没有伪造统一代理树。

本次接入不含单独打开子会话、对子代理直接发消息、单独取消子任务或为每个子任务选择模型。停止仍作用于当前主任务和它的 CLI 进程。

本次分别使用真实 Codex 与 Grok CLI，要求各创建一个子代理计算 `2 + 2` 并等待结果，两者均返回 `4`。Codex 收到原生 spawn／wait／completed 状态，Grok 收到 `spawn_subagent` 工具活动与子代理结果。该验证只覆盖最小委派链路，不代表多代理并行写代码、所有模型或不同 CLI 版本均已验收。

## `/goal` 与 `/plan` 的实际实现

| 能力 | Codex | Grok | Pi |
| --- | --- | --- | --- |
| Goal | 原生 `thread/goal/set`、`get`，底座继续执行；支持 token budget 与暂停 | 通过 ACP 发送原生 `/goal ...` 命令 | 未接入 |
| Plan | 原生 `collaborationMode: plan`；计划审阅、修改版本、批准后切回 `default` 执行 | Moose 暂未接入，尽管 Grok 自己支持 `/plan` | 未接入 |
| Subagent | 原生委派工具 + 结构化活动和审批 | 原生委派工具 + ACP 工具活动 | 未接入 |

任务模式的选择菜单由 Moose 实现，不意味着三个底座有相同命令语义。Codex 先检查 `collaborationMode/list`，用原生 Plan 生成计划；Moose 持久化计划版本，提供审阅和修改，再将批准的正文发送到同一原生会话执行。审批界面与版本约束由 Moose 管理。规划仍保留只读 sandbox、禁止提权；执行恢复该会话选择的权限档位。计划结束后暂停后续队列，不自动执行。[Codex app-server 文档](https://learn.chatgpt.com/docs/app-server)描述了原生协作模式；当前已启用协议生成的实验字段，并核对了本机 CLI 的接口与真实事件。[Grok Plan 文档](https://docs.x.ai/build/features/plan-mode)描述的是 Grok 自己的功能，不代表 Moose 已支持。

## 原生 Plan 与插话验证

本机 Codex 0.155.0、`gpt-5.6-luna`／low 实测：收到原生 plan item；规划阶段目录内容不变；同一会话切到执行模式后按修改后的内容写入隔离测试文件；插话返回同一 turn ID，最终回复包含插话要求的标记。复现脚本 `scripts/check-native-workflows.ts` 会使用真实模型额度。

插话记录先保存再投递，区分接收、拒绝与结果未知；明确拒绝保留输入，超时／断连不自动重发。同一 request ID 不会再次调用底座。运行已结束、取消中或任务模式不同则拒绝插话；它不会改变当前回合的权限或模型。插话消息暂不支持原地编辑。

Grok 1.0.34 的真实 ACP `session/new` 握手只报告 model 和 reasoning_effort 配置，未报告 modes。本轮没有把 Grok 的终端 `/plan` 能力当成可用的 ACP 审批流程；Grok Plan 接入仍待验证。

## 思考过程

Moose 对 Codex 显式传入 `summary: auto`，接收 `item/reasoning/summaryTextDelta`、`textDelta` 和最终 reasoning item。已收到的文本显示在可展开的“思考”记录；没有文本时隐藏空记录。Grok 对应 ACP `agent_thought_chunk`，两个通道的提供策略不一定相同。

2026-09-18 使用本机 Codex、`gpt-5.6-luna`、medium 做了一次独立最小探测：回答成功，reasoning 事件 0 条、摘要 0 字符。这个结果说明该次调用没有上游摘要，不能外推为所有模型、账号或 CLI 版本都不支持。复现脚本为 `scripts/check-reasoning.ts`，会使用真实模型额度。

[OpenAI 官方说明](https://developers.openai.com/api/docs/guides/reasoning#reasoning-summaries)区分不公开的原始推理 token 和可请求的思考摘要。不能把“没显示摘要”直接解释为应用隐藏了全部思考，也不能通过界面强制取回底座未提供的原始推理。

## 优先补齐的产品能力

分阶段接入方案与验收标准见[实施计划](native-capabilities-plan.md)。该计划不代表功能已经实现。

| 优先级 | 能力 | 当前 Moose 状态 |
| --- | --- | --- |
| 高 | 原生 Plan → 审阅／修改计划 → 批准执行 | Codex 已接原生 Plan、版本化修改与批准执行；Grok／Pi 未接入 |
| 高 | 运行中插话、调整任务方向 | Codex 已接 `turn/steer`；“立即发送”插话，普通发送保持排队；Grok／Pi 保持队列 |
| 高 | 子代理独立面板与控制 | 本次新增委派活动，尚无完整子会话管理 |
| 高 | Worktree 隔离、多任务并行与合并 | 同目录串行；没有 worktree 创建／清理／合并界面 |
| 中 | Git 操作与原生代码审查 | 有 diff 预览；没有暂存、提交、PR 和原生 `review/start` 流程 |
| 中 | MCP、插件、hooks、代理配置管理 | 有 skill 引用；未提供统一安装、认证、配置和错误诊断界面。CLI 自己加载的配置仍可能生效 |
| 中 | 原生会话导入、分叉、上下文压缩管理 | 有本地历史及编辑最新消息；没有通用原生历史浏览、显式 fork、手动 compact 界面 |
| 中 | 后台终端与定时任务 | 可关闭窗口继续任务；没有后台命令列表／交互终端和定时调度 |

这些是客户端接入差距，不是底座模型能力评判。可对照 [Codex app-server 接口](https://learn.chatgpt.com/docs/app-server)、[Codex 子代理](https://learn.chatgpt.com/docs/agent-configuration/subagents)、[Grok 子代理](https://docs.x.ai/build/features/subagents)与 [Grok 扩展能力](https://docs.x.ai/build/features/skills-plugins-marketplaces)。
