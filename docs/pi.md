# Pi 接入与代理层整理

## 如何使用

1. 安装官方 CLI：`npm install -g --ignore-scripts @earendil-works/pi-coding-agent`。
2. 在终端启动 `pi`，用 `/login` 登录所需模型服务，或按 Pi 文档配置 API 模型。
3. Moose 设置 → 服务商 → Pi，刷新检测；不在 PATH 中时填写可执行文件的绝对路径。
4. 输入区模型选择器中选 Pi 和实际可用模型，明确选择“完全访问”后发送。

Moose 不安装或捆绑 Pi，也不复制其凭据。实现依据 Pi 0.85.1 的 RPC 协议；模型和推理档位实时查询，不内置模型目录。

## 能力边界

- 支持流式正文、模型提供的思考内容、工具记录、停止、图片输入（取决于模型）、文件附件和原生会话恢复。
- Pi 保存 sessionFile；Moose 保存其路径，下次用 `--session` 恢复。编辑历史继续使用 Moose 的文本历史重建机制，不撤销工作区文件。
- Pi 没有内置审批沙箱，只能选择完全访问。扩展发出的确认和提问可显示为交互卡片，这不代表所有工具执行都受到审批保护。
- 不展示 Pi 不具备的原生 Plan/Goal 模式。支持读取全局 `~/.pi/agent/skills` 和项目 `.pi/skills`，也保留 Moose 原有 skills 路径。
- 上下文用量来自 `get_session_stats.contextUsage`；没有账户套餐额度接口，不推算或伪造剩余额度。
- 扩展的自定义 TUI、widget、终端编辑器不在此次接入范围内。

## 调用脉络

模型选择 → 受校验的 IPC → MooseService 排队 → createAdapter → PiAdapter → `pi --mode rpc`。

Pi 返回 JSONL 命令响应和事件。`piCodec` 只转换消息信封，共用原有传输层的请求关联、超时、缓冲限制和进程退出清理。`normalizePi` 将文本、思考和工具事件转成统一 AgentEvent；renderer 无需增加 Pi 专用时间线。

每个文本块的增量和完成快照使用同一个 key，避免重复显示。等待 `agent_settled` 而非 `agent_end`，因为后者之后可能仍有重试或压缩。

## 精简的内容

- `shared/providers.ts`：集中代理 ID、设置字段、安装指南和任务模式；类型、参数校验、服务商设置、命令菜单和探测脚本复用。
- `electron/providers/registry.ts`：集中实例创建，移除 Service 和脚本中的代理二选一分支。
- `electron/providers/prompt.ts`：复用附件文本封装及无原生引用协议的路径提示，保留 Codex 的原生 mention/skill 输入。
- 设置保存与代理重连只触发一次，移除 App 与设置页的重复探测。

不合并各协议的执行循环：Codex、ACP 与 Pi 的握手、完成事件和审批语义不同，保留独立适配器更易阅读和排查。

## 验证范围

Pi 0.85.1 真实 CLI 已完成 RPC 握手；当前环境尚未配置 Pi 模型，真实模型生成未验收。自动化使用隔离的协议 fixture，覆盖能力探测、事件归一化、扩展确认、停止、会话路径恢复及 Electron 中选择 Pi 后发送和持久化，不消耗模型额度。

协议参考：[Pi RPC 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)。
