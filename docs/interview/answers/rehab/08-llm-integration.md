# 八、模型接入：意图、通道、工具从哪来

> 对应答案：[08-llm-integration.md](../08-llm-integration.md)，原题 1、5、7。

这一章接上「循环放在可信侧」。一次工具调用还要过哪些检查、哪些检查不能放在浏览器，双向通道自己要带什么身份，工具定义又从哪来，都在这里。

## 模型只表达意图，应用负责执行

各家名字不同。早期 OpenAI 叫 Function Calling，现在多叫工具调用。OpenAI Responses API（2025 年 3 月）、Anthropic 的 tool use、Vercel AI SDK 的 `tools` 都是这一类。模型说「调用计算器」，只是给出了名字和参数。计算器不会因此自己跑起来。

应用要补上的顺序是：收全工具名和参数（流式时可能分好几段），确认名字在白名单里，确认参数符合这份工具的 JSON Schema，确认当前用户有权做这件事。有副作用的，先请用户批准。然后在可信后台执行，按原来的调用 ID 把结果或错误交还模型。还要有轮次上限和总超时，防止停不下来。

没收全参数不能执行。半截参数的展示规则在流式下篇：可以显示「正在准备」，不能跑命令。

失败也要按同一个调用 ID 交还。模型才知道这次失败了，可以换一种做法。丢掉错误、假装没调用过，模型会重复同一种尝试。

一次回答里可能有多个并行调用，逐个用 ID 匹配。互不依赖的可以并发。有依赖的仍要按顺序，见 Agent 上篇。

展示过程和收集审批放在前端，因为那只是界面。校验名字、参数、权限放在后端，因为前端校验可以被绕过。执行放在后端，因为需要凭据和系统权限。把结果接回模型、进入下一轮也放在后端，防止有人伪造工具结果。

浏览器不应保存数据库凭据，也不应执行任意命令。这条和架构章「长期密钥不进浏览器」是同一条边界。

```ts
const tool = allowedTools[call.name];
if (!tool) return { callId: call.id, error: '不允许的工具' };
const args = tool.schema.parse(call.args);
if (tool.sideEffect && !(await askUser(call))) {
  return { callId: call.id, error: '用户拒绝' };
}
return { callId: call.id, result: await tool.run(args) };
```

OpenAI 把这个 ID 叫 `call_id`，Anthropic 叫 `tool_use_id`。名字不同，作用都是把结果送回这一次调用。

## 双向通道要自己带身份

WebSocket 允许浏览器和后台在同一条连接上互发消息。生成增量、取消、审批可以走同一条管道。SSE 则是服务器往下推，浏览器再用别的 HTTP 请求往上发命令。两种都能做聊天。差别在上行是不是同一条连接。

无论用哪一种，消息自己要带身份，不能靠「这条连接上的下一帧一定是我要的」。类型说明这是增量、审批请求、完成，还是取消。`runId` 说明是不是当前这次任务。请求 ID 对上审批或取消是哪一次。序号用来发现重复和跳号。内容才是真正的数据。

```ts
socket.onmessage = ({ data }) => {
  const event = JSON.parse(data);
  if (event.runId !== activeRunId || event.seq <= lastSeq) return;
  if (event.seq !== lastSeq + 1) return reloadSnapshot();
  lastSeq = event.seq;
  apply(event);
};
```

连接中断之后，中间漏掉的消息不会因为「又连上了」重新出现。要靠服务端留着的事件，加上客户端记住的游标，补读缺口。这和 SSE 那章的 `Last-Event-ID` 是同一原理：游标只是声明，补得回是因为服务端存了。

连接要鉴权。还要限制缓冲区，并处理读得太慢的客户端，否则服务端会为一条没人消费的连接把内存撑满。

取消请求发出之后，要等服务端确认，才算真正取消。只把本地状态改成「已停止」，服务端任务可能还在跑。

SSE 是服务器推给浏览器，上行另走 HTTP。WebSocket 在同一连接上双向。两边断线后的缺口都不会自动补齐。SSE 除非服务端按 id 重放，WebSocket 同样不会自己把漏掉的帧变回来。页面要做的也一样：解析消息，按类型，按序号。

类型章把 `StreamEvent` 定义成与通道无关，就是为了这里换通道时不必改后面的状态更新。

## MCP：工具从外部服务来

每个应用都自己写一遍「读 GitHub」「查数据库」，工具就没法换宿主。MCP（Model Context Protocol）是 Anthropic 在 2024 年 11 月发布的开放协议，2025 年起被 OpenAI、Google 等采用。它用 JSON-RPC 2.0 规定：AI 应用怎样发现并调用外部服务提供的工具、资源和提示词模板。

它不取代工具调用。模型仍然通过工具调用表达「我要执行这个」。MCP 标准化的是「工具列表从哪来、调用怎样转发到外部进程或服务」。

Host 是用户直接用的 AI 应用，比如桌面聊天、IDE、代理 CLI。Client 是 Host 里负责连某一个 Server 的组件，一个 Server 一条连接。Server 是对外提供能力的服务，比如 GitHub、数据库、文件系统。

Server 可以提供三类东西。tools 是模型可以调用的操作。resources 是可以读取的数据。prompts 是提示词模板。

本地 Server 用 stdio，Host 拉起一个子进程，经标准输入输出通信。远程 Server 用 Streamable HTTP。它在 2025-03-26 版规范里取代了早先的 HTTP+SSE。远程用 OAuth 授权。

直接写工具时，定义和执行代码都在你的应用里。用 MCP 时，Host 运行时向 Server 要工具列表，交给模型。模型选中后，Client 再转发给 Server 执行。

一次调用的形状（示意）：

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "search_issues",
    "arguments": { "query": "crash" }
  }
}
```

**补充知识：** JSON-RPC 用 `id` 把请求和响应配对，`method` 是要调用的方法名。MCP 规定了这些 method 叫什么，例如 `tools/call`，这样不同 Host 和 Server 不必再私自约定一套。

第三方 Server 会带来安全问题。工具描述会原样进入模型上下文，恶意 Server 可以在描述里藏提示词注入。Server 拿到的权限常常过大：只需要读一个仓库，却给了整个账号的令牌。还有混淆代理（confused deputy）：Server 用自己的高权限替低权限的用户办事，用户借此做到本来无权做的事。

所以添加 Server、第一次调用工具、授权 OAuth，都应征得用户同意。令牌按最小范围申请。官方或热门，不代替这几步。

配置界面要让人看清将要启动的命令、参数、远程地址和环境变量。密钥用环境变量名引用，不把明文写进配置。新加的 Server 默认不启用。调用记录能看出是哪个 Server 的哪个工具。

远程地址如果允许任意 HTTP，或允许把用户名密码写在 URL 里，配置界面就会变成泄露和误连的入口。这些限制属于产品校验，不只是说明文字。

## 容易答错的地方

模型返回了工具调用，还不等于可以执行。中间还有收全参数、白名单、schema、权限，以及必要时的批准。

重新连上 WebSocket，只是通道回来了。补回漏掉的事件，要服务端留底，再加上游标。

模型侧仍是工具调用。MCP 管发现和传输。说「用了 MCP 就不用工具调用」，是把两层并成了一层。

应用自己去连 MCP Server，是 Host 和 Client 的事。读写某个 CLI 的配置文件或管理接口，是另一件事。

## Moose 里实际是这样

配置字段和文件路径见 [答案](../08-llm-integration.md)。面试只记和通用讲法不同的几条：

| 不要说成 | 实际 |
| --- | --- |
| 页面在调模型的工具 API | 工具由代理 CLI 决定和执行。页面展示记录，批准仍按原请求交还 |
| 有一条专给模型事件的 WebSocket | Web 是 HTTP 加 SSE，桌面是 IPC，进的是同一个后台 |
| Moose 实现了 MCP Client | 连接和调用在 CLI。Moose 只读写 Codex、OpenCode、Grok 的配置；Pi 不支持 MCP |
| 运行时把 MCP Server 注入进会话 | Grok 和 OpenCode 的 ACP 会话传入的 `mcpServers` 是空数组 |

地址校验仍在：远程只允许 HTTPS，或本机回环上的 HTTP，不能带用户名密码。秘密只填环境变量名。新 Server 默认不启用。

不要说 Moose 实现了 MCP Client。

## 合上之后能说的几句

模型给出的是工具名和参数。应用收全之后做白名单、schema 和权限检查。有副作用的先审批，在可信侧执行，再按调用 ID 把结果或错误送回去，并设轮次上限。浏览器只负责展示和收集批准。

双向通道上的每条消息自带类型、`runId`、请求 ID 和序号。断线后靠服务端保存的事件补缺口。重连本身不会把漏掉的帧变回来。取消也要等确认。

MCP 用 JSON-RPC 把「发现工具、转发调用」标准化。模型侧仍是工具调用。第三方 Server 的描述和权限都不可信。默认不启用，秘密只用环境变量名。

Moose 的页面不调模型工具 API，也没有模型事件用的 WebSocket。Web 是 HTTP 加 SSE，桌面是 IPC。MCP 的连接在 CLI 里。Moose 只读写 Codex、OpenCode、Grok 的配置，并做传输和地址校验。Pi 不支持 MCP。
