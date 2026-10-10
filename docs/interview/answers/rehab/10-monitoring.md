# 十、监控：让线上问题能回答四个问句

> 对应答案：[10-scenarios-performance-monitoring.md](../10-scenarios-performance-monitoring.md)，原题 6、16、22、23、30、31。

监控不是把浏览器事件都传上去。目标是线上出了问题时能回答：哪里出错、影响了谁、什么时候变慢、关键操作有没有完成。答不上这四句的数据，量越大越难用。

## 浏览器已经记了性能，按问题去订阅

`PerformanceObserver` 像订阅器。你声明想看哪一类记录，之后在回调里收下它们。订阅前看 `PerformanceObserver.supportedEntryTypes`，当前浏览器没有的类型不要硬订。

很多加载在你的脚本执行前就已经发生。`observe({ type, buffered: true })` 会把订阅前的记录补给你。`buffered` 只配合单个 `type`，不能和 `entryTypes` 数组一起用。

导航和资源加载看 `navigation`、`resource`。主要内容何时出现，看 `largest-contentful-paint`，或 web-vitals 库的 LCP。交互卡不卡，看 INP。卡在哪段脚本，看 `long-animation-frame`。没有就退回 `longtask`。

长任务（`longtask`）表示主线程被一段任务连续占用 50ms 以上。记录里有开始时间和持续时间，通常看不出是哪个业务函数。它回答「什么时候卡了多久」，不回答「哪一行」。

INP（Interaction to Next Paint）是从用户交互到下一帧画面的延迟。它在 2024 年 3 月取代 FID，成为 Core Web Vitals 之一。FID 只看第一次交互的输入延迟。INP 看整次访问里交互的整体响应。不要再把 FID 当成现行核心指标。

Long Animation Frames（LoAF）从 Chrome 123 起提供，目前只有 Chromium 系浏览器有。它记录渲染被拖慢超过 50ms 的帧，并在 `scripts` 里给出脚本来源、函数名和各自耗时。诊断慢交互时比 `longtask` 有用。Safari 和 Firefox 上要有退路。

```ts
const supported = PerformanceObserver.supportedEntryTypes;
const type = supported.includes('long-animation-frame')
  ? 'long-animation-frame'
  : 'longtask';
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    record(type, entry.startTime, entry.duration, entry.scripts);
  }
}).observe({ type, buffered: true });
```

LCP、CLS 会多次产生或更新记录，不能随便拿某一条当最终值。实际项目常用 web-vitals 库，它处理了这些结算规则。

自己的业务阶段用 `performance.mark` 打点，`performance.measure` 算两点之间。回调里只做轻量收集，聚合和采样放到后面。不同进程的 `performance.now()` 起点不同，不能直接相减。

## 资源耗时和接口耗时，浏览器只帮你记到一半

Resource Timing 是浏览器为每个资源记的时间，包括 DNS、连接、请求、响应等阶段。图片、脚本、样式之外，`fetch` 和 XHR 也会出现，`initiatorType` 为 `fetch` 或 `xmlhttprequest`。

页面加载时先 `performance.getEntriesByType('resource')` 读已有的，再用 Observer 订后面的。

跨域资源如果没有响应头 `Timing-Allow-Origin`，各阶段的详细时间不可见，往往只剩开始和结束。能把 CDN 上的图显示出来，不等于能拿到它的分段耗时。

资源记录的缓冲区有上限。停留很久的页面要定期消费，或调用 `performance.setResourceTimingBufferSize`，否则旧记录被挤掉。

Resource Timing 不知道这次请求属于哪个业务操作，也不记失败原因。统一的 fetch 入口再包一层：

```ts
const started = performance.now();
try {
  const response = await fetch(input, init);
  record({
    route,
    status: response.status,
    headersMs: performance.now() - started,
  });
  return response;
} catch (error) {
  record({ route, failedMs: performance.now() - started });
  throw error;
}
```

这里要先约定终点。`fetch` 的 Promise 完成时，通常是响应头到了，正文可能还没读完。流式正文要另记「读完」的时间。HTTP 4xx 和 5xx 不会让 `fetch` 抛错，要看 `response.ok`。失败和取消也结算一次，否则你只统计了成功，慢和错都看不见。

路由要规范化。`/users/123` 收成 `/users/:id`，否则每个 ID 都是一种接口，统计散掉。上报前去掉 URL 里的 token，并排除监控请求自己。

采样、批量发送。页面隐藏时用 `navigator.sendBeacon` 把剩下的发出去。普通 `fetch` 在卸载时可能被取消。`sendBeacon` 就是为这种「页面要走了，仍想送出一小段」准备的。

## 还原操作：同一条 ID 上的时间线

「点了发送没反应」需要的是顺序，不是最后一条红字。一次会话一个 ID，或一次操作一个 trace ID。记下页面、关键操作、请求、状态变化、错误，附上版本和设备，按时间排开。

trace ID 贯穿前端操作和后端请求，两边的日志才能对上。

需要画面回放时，再采集脱敏后的 DOM 变化。密码、输入内容、附件默认遮住。控制采样比例和保存多久。DOM 回放也复原不了所有 Canvas，也复原不了外部系统当时的状态。

全站请求都进同一个封装函数。等请求失败再看堆栈，经常只看见这个公共函数。在发起的那一刻抓：

```ts
const callerStack = new Error().stack;
try {
  return await fetch(url);
} catch (error) {
  report({ error, callerStack, requestId });
  throw error;
}
```

连同 `requestId` 和发布版本一起上报。线上代码是压缩过的，堆栈里的行号指向压缩文件。用对应版本的 source map 才能映射回源码。映射会失败，所以同时记一个稳定的业务名，例如「提交订单」。采样、脱敏，避免上传本机路径，也避免每个请求都付抓堆栈的成本。

**补充知识：** source map 是构建时生成的文件，记录压缩代码的行列和源文件行列的对应。没有同一版本的这份文件，堆栈还原不回去。

## 方案先定问题，处理反馈先定症状

采集四类就够覆盖那四个问句：JS 异常、请求失败、页面性能、业务失败（例如「提交订单」没有成功）。每条带上版本、页面、会话 ID 或 trace ID。

告警按影响人数和严重程度触发，同一种错误先去重。一个报错刷满通道，真正新的问题会被淹没。上报要采样、脱敏，并限定保存期限。

用户反馈的处理是另一条流程。监控数据是输入，不是全部。先记下版本、环境、步骤、预期和实际结果。征得同意再收日志。按影响面和能否复现排序。复现之后再定位、修复、回归，把结果回给用户。

用户报告的是症状，不是根因。没复现就改代码，很容易改错地方。

## 容易答错的地方

长任务是一段时间。LoAF 的 `scripts` 才更接近「哪段脚本」。两者都还不一定是某一行业务代码，最后仍可能要性能工具。

现行交互指标是 INP，不是 FID。

资源能显示出来，不等于 Timing 的各阶段看得见。后者要 `Timing-Allow-Origin`。

`fetch` 抛错通常是网络断开。HTTP 的 4xx 和 5xx 走成功回调，看 `response.ok`。

接口返回「已入队」时，请求已经结束，模型任务才刚开始。请求耗时和任务耗时不是同一个数。

任务时间线能追一次执行。点击回放才知道用户点了什么。Moose 有前者的本地记录，没有后者的遥测平台。

## Moose 里实际是这样

Moose 只用脚本量特定流程，没有 PerformanceObserver 产品采集，也没有逐资源的 Resource Timing 或远程监控平台。任务和错误在本地 SQLite 的时间线上，这不等于记下了每一次点击。`send` 返回的是队列项，不是任务结束。「没反应」先看会话和 `runId` 卡在页面、后台还是 CLI。入队、运行、等待审批和失败是不同状态。

## 合上之后能说的几句

监控围绕四句：哪里错、影响谁、何时变慢、关键操作完成了没有。浏览器性能用 Observer 按类型订阅，并用 `buffered` 补读。交互看 INP。卡顿的脚本归因优先 LoAF，没有则退回长任务。

静态资源和 fetch 的网络时间在 Resource Timing 里。跨域细节取决于 `Timing-Allow-Origin`。业务含义在统一请求入口用 `performance.now()` 另记。4xx 不算抛错。流式正文另记读完。

还原现场用会话或 trace ID 串起操作和错误。堆栈在发起时抓，再用同版本 source map 对行号。敏感内容默认不上传。告警按影响去重。处理反馈时先写成可复现的步骤，复现后再改。
