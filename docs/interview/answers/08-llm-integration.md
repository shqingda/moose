# 八、大模型前端集成

> 本章 3 题，题号沿用原题号。每题按“这题在考什么 → 一句话回答 → 展开说明 → 示例 → Moose 里的做法 → 容易答错的地方”排列。[题目列表](../questions.md) ｜ [答案目录](README.md)

## 1. 大模型的工具调用（tool calling）在应用里怎么落地？哪些步骤必须放在后端？

> **这题在考什么**：早期 OpenAI 把这个能力叫 Function Calling，现在各家统一叫工具调用：OpenAI 在 2025 年 3 月推出的 Responses API、Anthropic 的 tool use、Vercel AI SDK 的 `tools` 都是这一类。名字不同，本质一样：模型说“调用计算器”，只是给出了调用意图，工具并不会因此自动执行。面试官想看你清楚应用要负责验证、执行、回传结果，以及这些事该在哪里做。

**一句话回答**：模型只输出工具名和参数；应用收全参数后校验名称、参数格式和用户权限，在可信后台执行（有副作用的先请用户批准），再按原来的调用 ID 把结果或错误交还模型，并设循环上限。

**展开说明**
- 先收全模型给出的工具名和参数。流式返回时参数可能分几段到达，没收全不能执行。
- 校验三件事：工具名在白名单里、参数符合 JSON Schema、当前用户有权限做这件事。
- 由可信后台执行。浏览器里的代码用户可以随意修改，所以凭据、数据库访问和命令执行都不能放在前端。
- 有副作用的工具（写数据库、发邮件、改文件）在执行前要让用户确认，只读工具可以直接执行。
- 结果按原来的调用 ID（OpenAI 叫 `call_id`，Anthropic 叫 `tool_use_id`）交还模型；失败也要回传错误，模型才能换一种做法。
- 一次回答可能包含多个并行调用，要逐个匹配 ID；互不依赖的可以并发执行。
- 设置循环轮次上限和总超时，防止模型反复调用停不下来。

| 步骤 | 放在哪里 | 原因 |
| --- | --- | --- |
| 展示调用过程、收集审批 | 前端 | 只是界面 |
| 校验工具名、参数、权限 | 后端 | 前端校验可被绕过 |
| 执行工具 | 后端 | 需要凭据和系统权限 |
| 拼接结果、继续下一轮 | 后端 | 要防止伪造结果 |

**示例**：下面是后台执行前的关键检查，白名单、参数校验和审批（伪代码）。

```ts
const tool = allowedTools[call.name];            // 只查白名单里的工具
if (!tool) return { callId: call.id, error: '不允许的工具' };
const args = tool.schema.parse(call.args);       // 参数不合法会直接抛错
if (tool.sideEffect && !(await askUser(call))) {  // 有副作用的先请用户批准
  return { callId: call.id, error: '用户拒绝' };
}
return { callId: call.id, result: await tool.run(args) }; // 带回原调用 ID
```

**Moose 里的做法**：Moose 不在 Renderer 里直接调用模型的工具 API。决定和执行工具的是代理 CLI；适配器把 CLI 发出的事件转成工具记录，Service 负责保存和推送。CLI 请求审批时，适配器记住原始请求 ID 和可选项，用户的回复经 Service 校验仍有效后，再按原请求 ID 交还 CLI（细节见[六、AI 特性与前端工程实践](06-ai-features.md#11-agent-要执行危险操作改文件跑命令联网前审批界面该怎么设计)）。

**容易答错的地方**
- 浏览器不应保存数据库凭据，也不应执行任意命令。
- 以为模型返回了工具调用就要立刻执行。参数校验和权限检查都通过、需要时用户也批准了，才能执行。

## 5. 如何用 WebSocket 实现双向流式通信，支持 AI 模型主动推送进度更新、中断信号、工具调用请求？

> **这题在考什么**：WebSocket 允许浏览器和后台在同一个连接上互相发消息，适合同时传生成内容和取消、审批这类指令。但面试官想看你是否知道：连接断开后，之前漏掉的消息不会自己回来。

**一句话回答**：先约定带类型、`runId`、请求 ID 和序号的消息格式，服务端推增量和请求，客户端发审批和取消；断线后靠服务端保存的事件和游标补读。

**展开说明**
- 消息格式包含：类型、`runId`、请求 ID、序号和内容。
- 服务端推送生成增量、工具调用请求和完成通知；客户端发送审批、取消等指令。
- 连接中断后，要靠服务端保留的事件和客户端的游标补读漏掉的部分。
- 连接要做鉴权，限制缓冲区大小，并处理消费太慢的客户端，避免服务端内存被撑满。
- 取消请求发出后，要等服务端确认才算真正取消。

**示例**：下面在收到事件时先核对是不是当前任务、序号是否连续（客户端示意）。

```ts
socket.onmessage = ({ data }) => {
  const event = JSON.parse(data);
  if (event.runId !== activeRunId || event.seq <= lastSeq) return; // 别的任务或重复事件
  if (event.seq !== lastSeq + 1) return reloadSnapshot();          // 缺号，重拉完整状态
  lastSeq = event.seq; apply(event);                               // 正常应用
};
```

**Moose 里的做法**：Moose Web 用 HTTP 发命令、用 SSE 接收后台事件；桌面端经 preload/IPC 转发到同一个后台。它没有用于模型事件的 WebSocket 服务。

**容易答错的地方**
- 重新打开 WebSocket 本身不会恢复漏掉的内容。

## 7. MCP 是什么？和直接写工具调用有什么区别，前端/全栈要关心什么？

> **这题在考什么**：每个 AI 应用都给模型单独写一遍“读 GitHub”“查数据库”的工具，重复又难以复用。MCP 想把工具接入标准化，让一个工具服务能被多个 AI 应用使用。面试官想看你说清它的角色和传输方式、它和自己写工具调用的关系，以及引入第三方工具服务带来的安全问题。

**一句话回答**：MCP（Model Context Protocol）是 Anthropic 在 2024 年 11 月发布的开放协议，2025 年起被 OpenAI、Google 等采用；它用 JSON-RPC 2.0 规定 AI 应用怎样发现和调用外部服务提供的工具、资源和提示词模板。它不取代工具调用：模型仍然通过工具调用表达意图，MCP 只是把“工具从哪来、怎么调”标准化了。

**展开说明**

| 角色 | 是什么 | 例子 |
| --- | --- | --- |
| Host | 用户直接使用的 AI 应用 | 桌面聊天应用、IDE、代理 CLI |
| Client | Host 内部负责连接某一个 Server 的组件 | 每个 Server 对应一个连接 |
| Server | 对外提供能力的服务 | GitHub、数据库、文件系统的 MCP 服务 |

- Server 可以提供三类东西：工具（tools，模型可调用的操作）、资源（resources，可读取的数据）、提示词模板（prompts）。
- 传输方式：本地 Server 用 stdio，Host 启动一个子进程，通过标准输入输出通信；远程 Server 用 Streamable HTTP，它在 2025-03-26 版规范里取代了早先的 HTTP+SSE 方式。远程 Server 用 OAuth 授权。
- 和直接写工具调用的区别：直接写时，工具定义和执行代码都在你的应用里；用 MCP 时，Host 在运行时从 Server 拿到工具列表交给模型，模型选中后再由 Client 转发给 Server 执行。
- 安全问题：
  - 工具描述会原样进入模型上下文，恶意 Server 可以在描述里藏提示词注入。
  - Server 拿到的权限常常过大，比如只需读一个仓库，却给了整个账号的令牌。
  - 混淆代理（confused deputy）：Server 用自己的高权限替低权限的用户办事，用户借此做到本来无权做的事。
  - 所以添加 Server、首次调用工具、授权 OAuth 都应征得用户同意，令牌按最小范围申请。
- 前端/全栈要关心的：配置界面要清楚展示要启动的命令、参数、远程地址和环境变量；密钥用环境变量引用而不是明文写进配置；新加的 Server 默认不启用；调用记录要能看到是哪个 Server 的哪个工具。

**示例**：下面是 Client 调用 Server 工具时的一条 JSON-RPC 请求（示意）。

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": { "name": "search_issues", "arguments": { "query": "crash" } }
}
```

**Moose 里的做法**：Moose 自己不连接 MCP Server，连接和调用都由底层代理 CLI 完成；Moose 做的是读取和修改这些 CLI 的 MCP 配置。
- 读取：Codex 通过 app-server 的 `config/read` 读出各配置层里的 `mcp_servers`，再用 `mcpServerStatus/list` 查认证状态和工具数量（`electron/providers/codex-extensions.ts`）；Grok 运行 `grok mcp list --json`，只取用户级配置；OpenCode 直接解析配置文件里的 `mcp` 字段；Pi 不支持 MCP（`electron/providers/user-extensions.ts`）。
- 修改：新增和编辑只开放给 Codex（经 `config/value/write` 写入，并带上 `expectedVersion`，配置被别人改过就拒绝）和 OpenCode（原子替换配置文件，保留注释，文件被外部改过也拒绝）；Grok 只能用 `grok mcp enable/disable` 开关。
- 校验：`shared/mcp-registration.ts` 只接受 stdio 和 HTTP 两种传输；远程地址必须是 HTTPS，或者本机回环地址上的 HTTP，且不能带用户名密码、查询参数和片段；令牌和请求头只能填环境变量名，不能填明文值；新登记的 Server 一律写成未启用。保存前 `src/components/extension-confirm.tsx` 会列出命令、参数、环境变量或请求头让用户确认。
- 认证：Codex 的 MCP OAuth 登录通过 `mcpServer/oauth/login` 发起，Moose 只接受 HTTPS 且不带凭据的授权地址。
- 运行任务时，Grok 和 OpenCode 的 ACP 会话传入的 `mcpServers` 是空数组，Moose 不额外注入 Server，CLI 使用自己配置里的 MCP；Codex 的 MCP 工具调用会作为工具记录显示在时间线上。

**容易答错的地方**
- 说 MCP 取代了工具调用。模型那一侧仍然是工具调用，MCP 管的是工具的发现和传输。
- 认为装了官方或热门的 MCP Server 就安全。工具描述和返回内容都可能带注入，权限也要按最小范围给。
- 说 Moose 实现了 MCP Client。它只管理底座 CLI 的配置，真正连接 Server 的是 CLI。

---

上一章：[七、AI 工程化与前端工具链](07-engineering-toolchain.md) ｜ [答案目录](README.md) ｜ 下一章：[场景题：页面交互、浏览器 API 与 React](09-scenarios-ui-react.md)
