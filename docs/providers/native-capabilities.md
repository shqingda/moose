# 底座能力与接入边界

以 Moose **0.19.0** 为客户端基线；底座协议探测日期与版本分别见文末验证记录。下表描述 Moose 已经接入的能力，不评价各 CLI 的全部功能。入口同时受本机版本、握手结果和会话状态约束；底座名称相同，不代表所有安装环境都可用。

## 支持范围

| 能力 | Codex | Grok Build | Pi | OpenCode v2 |
| --- | --- | --- | --- | --- |
| 对话、模型选择、原生会话延续 | 支持 | 支持 | 支持 | 支持 |
| 权限档位 | 请求批准、原生自动审核、完全访问 | 请求批准、完全访问 | 仅完全访问 | 请求审批，遵循 CLI 配置 |
| 原生 Plan 审阅后执行 | 支持 | 未接入 | 未接入 | 未接入 |
| Goal | `thread/goal/*` | ACP 转交 `/goal` | 未接入 | 未接入 |
| 当前回合插话 | `turn/steer` | `_x.ai/interject` | 普通队列 | 普通队列 |
| 原生子代理 | 活动、历史面板及受限控制 | 工具活动与结果 | 未接入专门管理 | 未接入专门管理 |
| 浏览与导入 CLI 历史 | 支持 | 回放导入 | 未接入 | 未接入 |
| 显式分叉、手动压缩、原生代码审查 | 支持 | 未接入 | 未接入 | 未接入 |
| 配置、MCP、插件管理 | 用户级配置、MCP、插件；Hooks 只读 | MCP 启停、插件管理 | 默认模型、扩展包安装卸载 | 默认模型、MCP 增改与启停、插件安装卸载 |
| 套餐额度查询 | 原生额度接口 | 原生 billing 扩展 | 未接入 | 未接入 |

会话延续与历史导入是两件事：前者在后续消息中复用当前原生会话，后者浏览并引入用户此前在 CLI 中创建的会话。图片输入按实际模型或握手能力开放。Pi 的扩展提问不是工具审批沙箱。

底座注册与构造入口为 [providers.ts](../../shared/providers.ts) 和 [registry.ts](../../electron/providers/registry.ts)，统一接口见 [AgentAdapter](../../electron/providers/types.ts)。协议差异与完成信号见[技术架构](../architecture.md#6-代理接入统一接口保留能力差异)。

## Plan、Goal 与插话

Codex Plan 使用原生 `collaborationMode: plan`，先核对底座的模式能力。Moose 保存计划版本，提供审阅和修改；批准后将确定版本送入同一原生会话，切回 `default` 执行。规划保留只读约束，执行恢复会话权限；Plan 结束会暂停队列，不自动批准或执行。Grok CLI 自身的 `/plan` 不等于 Moose 已接通相同的 ACP 审阅流程。

Codex Goal 由原生目标接口保存和推进，支持预算与暂停；Grok 将命令交给原生 CLI。界面中的模式菜单由 Moose 提供，不是 Moose 自行模拟底座的推理循环。

运行中普通发送进入 Moose 的持久化队列，当前任务结束后再开始下一轮；“立即发送”调用受支持底座的原生插话接口。它不改变本轮模型、权限或模式，也不用“取消后重启”冒充 steering。投递记录区分已接收、明确拒绝和结果未知；拒绝保留输入，超时或断连不自动重发。相关实现见 [plans.ts](../../electron/plans.ts) 和 [steering.ts](../../electron/steering.ts)。

## 子代理与原生历史

Codex、Grok 根据任务和原生配置自行决定是否委派；Moose 默认接收活动，没有委派开关，也不强制每轮创建子任务。工具返回与子任务完成分别展示，子线程结束不能结束主任务。

Codex 面板展示底座提供的父线程、模型、状态和历史。发送、停止等控制受原生活动连接约束；`thread/resume` 只是加载会话，不能冒充恢复已关闭的子任务。Grok 展示 ACP 工具活动及结果，没有伪造统一子代理树。Moose 不提供独立选择子代理模型的入口。

导入历史保留来源并识别重复导入，不持续同步外部 CLI。原生分叉分开对话上下文，不隔离文件；代码隔离由 Git worktree 完成。压缩、分叉和审查也需要分别跟踪其完成事件，不能仅凭请求返回认定操作结束。

## OpenCode v2

安装与登录按 [OpenCode v2 文档](https://opencode.ai/v2/docs)：

```sh
brew install anomalyco/tap/opencode-v2
opencode auth login
opencode --version
```

Moose 搜索 PATH 和 `~/.opencode/bin`，也支持在设置中指定绝对路径。要求 CLI v2，不以旧版 SDK 中名为 `v2` 的导出路径判断版本。

[适配器](../../electron/providers/opencode.ts) 使用 [`opencode acp`](https://opencode.ai/v2/docs/cli/acp)，由 CLI 启动私有服务；与 Grok 共用基础 ACP 事件转换，专有能力分别处理。权限请求遵循 CLI 配置，Moose 不额外提供执行沙箱。独立历史、Plan／Goal 和用量查询尚未接入。配置页通过用户 JSON/JSONC 文件保留式更新及原生插件命令管理 OpenCode v2；不把 v1 的 MCP 字段直接用于 v2。

## 思考内容的边界

Codex 请求 `summary: auto`，Moose 展示实际收到的 reasoning 文本；没有文本时隐藏空记录。Grok 对应 ACP `agent_thought_chunk`。不同底座提供这些内容的策略不同，界面无法取回上游未提供的文本。

[OpenAI 的推理说明](https://developers.openai.com/api/docs/guides/reasoning#reasoning-summaries)区分原始推理与可返回的摘要，不能将未显示摘要简单归因为客户端隐藏了内容。2026-09-18 的一次 Codex／`gpt-5.6-luna`／medium 探测回答成功，但摘要为零；这只证明该次调用没有返回摘要，不代表所有模型、账号或版本。

## 哪些能力属于 Moose

持久化队列、目录互斥、worktree 生命周期、Git 提交和 PR 界面、用户手动 Shell、定时任务、桌面与浏览器共享后台由 Moose 管理。代理内部如何调用工具、委派子代理和延续原生目标则由底座负责。

安装版普通退出保留共享后台，任务可以继续；显式停止后台、电脑重启或后台崩溃不能靠历史记录恢复活进程。终端已支持 PTY，调度已支持单次、固定间隔、每天与每周规则；没有开机自启、任意 cron 或云端托管。

## 已验证到哪里

| 验证 | 已有证据 | 不能据此推断 |
| --- | --- | --- |
| Codex Plan／插话 | 0.155.0、`gpt-5.6-luna`／low 真实最小流程：规划未写文件、批准执行、同一 turn 接收插话 | 所有模型与后续 CLI 版本均兼容 |
| 原生委派 | Codex、Grok 各创建一个子代理计算 `2 + 2`，返回 `4` 与对应活动 | 多代理并行修改代码已全面验收 |
| 原生历史 | 2026-09-19 读取 Codex 0.155.1、Grok 1.0.34 历史通过 | 真实分叉、压缩均在该次重新执行 |
| Pi | 2026-09-21，0.85.1、`openai-codex/gpt-5.6-luna`：隔离目录真实文件写入、跨进程续接及运行中取消通过（取消后无迟到写入） | 所有模型与扩展均已验收 |
| OpenCode | 2026-09-21，2.0.10、`xai/grok-4.6`：隔离目录真实文件写入、跨进程续接、审批批准／拒绝与运行中取消通过 | 所有模型、权限配置与取消时机均已验收 |
| 当前客户端回归 | 0.19.0 单元、桌面／Web、打包验收通过 | 等价于对每个真实 CLI 的全能力认证 |

最低成本检查见[测试指南](../testing.md)，旧版本的详细证据见[阶段验收归档](../releases/feature-validation-history.md)。真实模型脚本会消耗额度，应与只读探测分开执行。后续范围统一维护在[开发计划](native-capabilities-plan.md)。

2026-09-21 的 OpenCode 探测中，默认模型 `opencode/deepseek-v4.1-flash` 虽出现在列表中，实际请求返回 `Model unavailable`；显式选择 `xai/grok-4.6` 后通过。模型列表不等于账号实际可用性。最初续接流程未触发审批；后续使用临时项目的 shell `ask` 规则，分别验证批准后写入、拒绝不写入和取消后无迟到写入。Pi 无内置审批沙箱，未将扩展提问作为审批验收。

### 用户配置适配边界（待发布）

Grok 使用 `mcp list/enable/disable`、`plugin list/install/uninstall/enable/disable`；Pi 修改用户 `settings.json` 的默认模型并调用 `pi install/remove`；OpenCode v2 使用 `mcp.servers`、`disabled` 与 `plugins`，通过 JSONC 定点编辑保留注释和无关字段。写入会核对读取时的文件版本，不写项目级配置。非 Codex 的 MCP OAuth、Hooks，以及 Grok MCP 新增和默认模型编辑尚未接入，界面隐藏这些入口。

依据：[Grok 设置](https://docs.x.ai/build/settings)、[Pi 设置](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/settings.md)、[OpenCode v2 MCP 源码](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/config/mcp.ts)。原生命令已用隔离目录核对，不启动模型任务。
