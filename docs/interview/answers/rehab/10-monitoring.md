# 场景题：性能、监控与线上问题

> 题单，对着说。每题顺序固定：这题在考什么 → 一句话回答 → 展开说明 → 示例 → Moose 里的做法 → 容易答错的地方。对应 [答案](../10-scenarios-performance-monitoring.md)，原题 6、16、22、23、30、31。事实按 Moose 0.23.3。答题稿里写了「没有」的，不要说成已经做了。

## 6. 怎样用 PerformanceObserver 采集页面性能？长任务、INP 和 LoAF 分别说明什么？
*（合并了原第 6、7 题）*

> **这题在考什么**：浏览器会自动记录页面导航、资源加载、绘制和交互等性能事件；用户点了按钮却隔一会儿才有反应，常见原因是主线程被某段 JavaScript 长时间占用。面试官想看你知道怎样按需订阅这些记录、2024 年后衡量交互卡顿的指标变成了什么，以及怎样把卡顿定位到具体脚本。

**一句话回答**：用 `PerformanceObserver` 按问题订阅 `navigation`、`resource`、`paint`、`largest-contentful-paint` 等类型并加 `buffered: true`；交互卡顿看 INP，诊断原因优先用 Long Animation Frames（`long-animation-frame`）拿到脚本归因，`longtask` 只能说明“什么时候卡了多久”。

**展开说明**
- `PerformanceObserver` 像一个订阅器：告诉浏览器你想看哪类性能记录（entry），之后它在回调里把记录交给你。订阅前用 `PerformanceObserver.supportedEntryTypes` 检查当前浏览器支持哪些类型。
- 用 `observe({ type, buffered: true })` 补读订阅之前已经产生的记录，因为脚本执行时很多加载事件已经发生了。注意 `buffered` 只配合单个 `type` 使用，不能和 `entryTypes` 数组一起用。
- 长任务（`longtask`）指主线程被一段任务连续占用 50ms 以上，记录里有开始时间和持续时间，但通常看不出是哪个业务函数。
- INP（Interaction to Next Paint，从用户交互到下一帧画面的延迟）在 2024 年 3 月取代 FID 成为 Core Web Vitals（谷歌定义的核心体验指标）之一。FID 只看第一次交互的输入延迟，INP 看整个访问期间交互的整体响应速度。
- Long Animation Frames API（简称 LoAF）从 Chrome 123 开始提供，目前只有 Chromium 系浏览器支持。它记录渲染被拖慢超过 50ms 的帧，并在 `scripts` 字段里给出脚本来源、函数名和各自耗时，诊断慢交互时比 `longtask` 更有用。
- LCP（最大内容绘制）、CLS（累计布局偏移）这类指标会多次产生或更新 entry，不能随便拿某一条当最终值。实际项目通常直接用谷歌的 web-vitals 库，它处理了这些结算规则。
- 自己的业务阶段（比如“打开弹窗到数据显示”）用 `performance.mark` 打点、`performance.measure` 计算两点间耗时。回调里只做轻量收集，之后聚合并采样上报。

| 想回答的问题 | 订阅或使用 |
| --- | --- |
| 页面导航、资源加载耗时 | `navigation`、`resource` |
| 首屏主要内容多久出现 | `largest-contentful-paint`（或 web-vitals 的 LCP） |
| 交互是否卡 | INP（web-vitals） |
| 卡在哪段脚本 | `long-animation-frame`，不支持时退回 `longtask` |

**示例**：下面的代码在支持时订阅 LoAF，否则退回长任务，并补读订阅前的记录。

```ts
const supported = PerformanceObserver.supportedEntryTypes;
const type = supported.includes('long-animation-frame') ? 'long-animation-frame' : 'longtask';
new PerformanceObserver((list) => {
  // LoAF 的 entry 带 scripts 字段，可以看到是哪个脚本耗时；longtask 没有
  for (const entry of list.getEntries()) record(type, entry.startTime, entry.duration, entry.scripts);
}).observe({ type, buffered: true }); // buffered 只能配合单个 type
```

**Moose 里的做法**：Moose 的性能脚本用 `performance.now()` 测量特定流程；产品内没有用 `PerformanceObserver` 持续采集页面性能条目，也没有自动采集长任务。遇到长回答卡顿时，需要用浏览器性能工具定位。

**容易答错的地方**
- 长任务记录的是主线程被连续占用的时间段，不等于知道了是哪一行代码导致的。
- 不要再把 FID 当作现行核心指标来答，交互指标已经换成 INP。
- LoAF 目前只在 Chromium 系浏览器上有，Safari、Firefox 上要有兜底。
- 不同进程各自的 `performance.now()` 起点不同，不能直接相减。

## 16. 怎样统计全站每个静态资源和接口请求的耗时？
*（合并了原第 16、57 题）*

> **这题在考什么**：想知道是哪张图片、哪个脚本拖慢了页面，或者“接口到底慢不慢”，只看页面总耗时不够，需要按资源、按接口分别统计。面试官想看你会用 Resource Timing，知道跨域和缓冲区限制，并能在统一请求入口补上业务层面的耗时和失败信息。

**一句话回答**：静态资源和 fetch/XHR 的网络耗时都可以从 Resource Timing 读取；业务层面的接口耗时再在统一的 fetch 或 Axios 入口里用 `performance.now()` 计时，附带路由、状态码和 requestId；两类数据都采样、批量，用 `sendBeacon` 上报。

**展开说明**
- Resource Timing 是浏览器为每个资源自动记录的耗时数据，包括 DNS、连接、请求、响应等阶段和资源类型。图片、脚本、样式之外，fetch 和 XHR 请求也会出现在里面（`initiatorType` 为 `fetch` 或 `xmlhttprequest`）。
- 页面加载时先用 `performance.getEntriesByType('resource')` 读出已有记录，再用 `PerformanceObserver` 订阅之后的记录。
- 跨域资源如果没有返回 `Timing-Allow-Origin` 响应头，各阶段的详细时间不可见，只剩开始和结束时间等少量信息。
- 资源记录缓冲区有上限。长时间停留的页面要定期消费记录，或调用 `performance.setResourceTimingBufferSize` 调整，避免溢出丢数据。
- Resource Timing 不知道这次请求属于哪个业务操作，也不记录请求失败的原因。所以在统一请求入口再包一层：用 `performance.now()`（单调递增的高精度时钟，不受修改系统时间影响）记录开始和结束，附带方法、规范化后的路由（如把 `/users/123` 归并为 `/users/:id`）、状态码、页面和 requestId。
- 先约定耗时的终点：一次请求有“发出、收到响应头、读完正文”几个时间点，不统一定义，两份数据没法比较。失败和取消也要结算一次。
- 上报按页面、资源类型或路由、发布版本汇总；采样并批量发送，页面隐藏时用 `navigator.sendBeacon` 发出剩余数据。上报前去掉 URL 里的 token 等敏感参数，并排除监控上报自身的请求。

**示例**：下面这段代码在统一入口里包住请求，统计到响应头到达为止的耗时。

```ts
const started = performance.now();
try {
  const response = await fetch(input, init);
  // fetch 返回时通常只是响应头到达；4xx/5xx 也会走到这里
  record({ route, status: response.status, headersMs: performance.now() - started });
  return response;
} catch (error) {
  record({ route, failedMs: performance.now() - started }); // 网络失败、取消也记一次
  throw error;
}
```

**Moose 里的做法**：Moose 目前没有逐资源的 Resource Timing 采集，也没有统一的全站请求耗时统计器；性能脚本测的是指定的应用流程。Moose 的 `send` 返回的是队列项，任务是否完成要看后续的任务事件，所以请求耗时也不等于任务耗时。

**容易答错的地方**
- 能加载 CDN 资源，不代表能拿到它的全部阶段耗时，这取决于 `Timing-Allow-Origin`。
- HTTP 4xx/5xx 不会让 `fetch` 抛错，需要检查 `response.ok`；流式正文读完要另外记录时间。

## 22. 如何还原用户操作流程

> **这题在考什么**：用户反馈“我点了发送之后没反应”，只看最后一条报错往往看不出前面发生了什么。面试官想看你怎样把操作、请求、状态和错误串起来，还原问题现场，同时保护用户隐私。

**一句话回答**：用同一个会话 ID 或 trace ID 串起页面、关键操作、请求、状态变化和错误，附上版本和设备信息，按时间顺序还原流程；确实需要画面回放时再采集脱敏的 DOM 变化。

**展开说明**
- 给每次会话分配 ID，或用 trace ID（贯穿一次操作全链路的追踪标识）把前端操作和后端请求关联起来。
- 记录页面切换、关键操作、请求、状态变化和错误，并附上发布版本和设备信息。按时间排序后，就能看出大致流程。
- 需要视觉回放时，再采集 DOM 变化来重建画面，而且要脱敏。
- 密码、输入框内容和附件默认遮蔽，并控制采样比例和数据保存时长。

**Moose 里的做法**：Moose 的任务时间线能还原代理的活动，但这不等于完整记录了用户的每次点击。

**容易答错的地方**
- DOM 回放也不能复原所有 Canvas 内容或外部系统的状态。

## 23. 可有办法将请求的调用源码地址包括代码行数也上报上去？

> **这题在考什么**：全站请求都走同一个封装函数，请求失败时堆栈常常只指向这个公共函数，看不出是哪段业务代码发起的。面试官想看你知道要在“发起时”采集调用信息，以及如何把压缩代码还原成源码行号。

**一句话回答**：可以。在统一请求入口发起请求时采集调用堆栈，连同 requestId 和发布版本一起上报，再用对应版本的 source map 映射回原始文件和行号。

**展开说明**
- 在统一请求入口用 `new Error().stack` 获取当前调用堆栈。必须在发起请求时取，因为请求异步失败后再取，往往只能看到公共错误处理代码。
- 上报时带上 requestId 和发布版本号，方便和后端日志对应，也能找到对应版本的 source map。
- 线上代码通常经过打包压缩，堆栈里的行列号指向压缩后的文件。需要对应版本的 source map（压缩代码到源码的位置映射文件）才能还原。
- 堆栈并不总能准确还原，所以最好同时记录一个稳定的业务操作名，比如“提交订单”。
- 要采样和脱敏，避免上传本机路径，也避免为每个请求都付出采集堆栈的开销。

**示例**：下面的代码在发起请求时就捕获调用位置，失败时连同错误一起上报。

```ts
const callerStack = new Error().stack;   // 发起时记录调用堆栈
try { return await fetch(url); }
catch (error) { report({ error, callerStack, requestId }); throw error; } // 上报后继续抛出
```

## 30. 如何做好前端监控方案

> **这题在考什么**：线上用户说“页面坏了”，开发者却在本地复现不出来，这时只能靠监控数据排查。面试官想看你是否知道监控要解决什么问题，而不是只会说“接个 SDK 全量上报”。

**一句话回答**：监控的目标是让线上故障能回答“谁受影响、从哪个版本开始、坏在哪一步”，所以先定要排查的问题，再决定采集 JS 异常、请求失败、性能和业务失败这几类数据。

**展开说明**
- 先回答四件事：哪里出错、影响了谁、什么时候变慢、关键操作有没有完成。采集内容围绕这四件事来定，而不是把所有浏览器事件都上传。
- 对应地采集四类数据：JS 异常、请求失败、页面性能和业务失败（例如“提交订单”没有成功）。
- 每条数据都带上版本号、页面、会话 ID 或 trace ID（一次请求在前后端之间传递的追踪编号）。这样才能把同一次问题的多条记录串起来。
- 告警按影响人数和严重程度触发，并对同一错误去重，避免一个报错刷屏、淹没真正的问题。
- 上报要做采样（只上报一部分，控制成本）、脱敏（去掉手机号、令牌等敏感信息），并限定数据保存期限。

**Moose 里的做法**：Moose 把任务消息、审批和错误保存在本地 SQLite 数据库里，可以沿着时间线排查某一次任务。它没有完整的远程监控平台。

**容易答错的地方**
- 监控不等于“把所有事件都上传”。没有明确排查目标的数据，量越大越难用。

## 31. 如何标准化处理线上用户反馈的问题

> **这题在考什么**：用户反馈往往只有一句“发送后一直转圈”。面试官想看你能否把一句模糊的症状，变成一套可复现、可定位、可闭环的处理流程。

**一句话回答**：先把用户描述的症状整理成带环境和步骤的可复现记录，按影响范围排优先级，复现、定位、修复、验证回归后再回复用户。

**展开说明**
- 先记录关键信息：用户使用的版本、运行环境、操作步骤、预期结果和实际结果。征得用户同意后，再收集相关日志。
- 按影响范围和能否复现来排序。影响人多、能稳定复现的问题优先处理。
- 复现之后再定位根因、修复，并做回归验证，确认没有把别的功能改坏。
- 最后把处理结果回复给用户，让这条反馈有始有终。

**Moose 里的做法**：Moose 把“输入入队、运行中、等待审批、失败”分别记录为不同状态。用户反馈“没反应”时，先查当前会话和 `runId`（一次执行的编号），再判断问题卡在页面、后台服务还是代理 CLI。

**容易答错的地方**
- 用户报告的是症状，不等于根因。不先复现就直接改代码，很可能改错地方。

---

上一篇：[九、内容、布局与 React · 下](09-ui-react-2.md) ｜ [题单目录](README.md) ｜ 下一篇：[十一、请求怎么发 · 上](11-network-1.md)
