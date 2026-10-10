# 九、页面与浏览器 · 上：先问目的，再选信号

> 对应答案：[09-scenarios-ui-react.md](../09-scenarios-ui-react.md)，原题 1、4、8、9、12、14、15、18。下篇讲预览、划词、折叠、flex 和 React。

场景题看起来散，其实都在练同一件事：不要用一个笼统的信号去回答一个具体的问题。「是不是手机」回答不了排版。「窗口变了」也通知不到侧栏把中间挤窄。

## 设备：目的不同，该看的事实就不同

老办法是用正则解析 User-Agent。那是浏览器附在请求里的一段标识。它可以被伪装。出于隐私，主流浏览器已经把这段字符串精简并冻结，系统版本和机型不再如实给出。正则越写越长，结果越来越不准。

排版看视口宽度和 CSS 媒体查询。触控还是鼠标，看 `pointer` 和 `hover`。某个 API 能不能用，做特性检测，直接问这个函数在不在。统计、下载页默认推荐哪个包，服务端看 UA 或 Client Hints，并允许用户改。

屏幕宽不能证明是桌面。平板横过来可以很宽，桌面窗口也可以拉得很窄。有触屏的笔记本、接了鼠标的平板都很常见。用设备名去猜交互方式会猜错。

```ts
const touchFirst = matchMedia('(pointer: coarse) and (hover: none)').matches;
const canShare = typeof navigator.share === 'function';
const isMobile = navigator.userAgentData?.mobile ?? null;
```

`pointer: coarse` 表示主要输入是手指这类粗略指针。`hover: none` 表示不能悬停。两个一起，才接近「按触屏来设计」。

媒体查询的结果会变，例如平板后来接上鼠标。需要跟随变化时，用 `matchMedia(...).addEventListener('change', ...)`。

User-Agent Client Hints 是替代解析 UA 的接口。JS 里是 `navigator.userAgentData`，服务端是 `Sec-CH-UA-*` 请求头，需要更细的信息时再去要。它目前只有 Chromium 系浏览器有。Safari 和 Firefox 上 `navigator.userAgentData` 是 `undefined`，不能当唯一依据。服务端解析 UA 只适合统计或粗略默认值，并且始终给手动切换。

这一题的答案没有写 Moose 的设备判断实现。不要补一句「Moose 用了某种 UA 解析」。

## 电梯导航：点击定位和滚动高亮是两个方向

长文档侧边的目录，点一下跳到章节，滚动时高亮当前章节。两个方向都要做。

每个章节一个稳定 ID。点击目录用 `scrollIntoView`。章节设 `scroll-margin-top`，避免被固定头部挡住。用户滚动时，用 IntersectionObserver 看谁进入判定带，再更新高亮。点击后的平滑滚动期间，暂停「根据滚动改高亮」，否则会一路闪过。

`scroll-margin-top` 是滚动定位时在目标上方留出的距离。头部是固定定位时，没有它，标题会停在头部下面看不见的位置。

IntersectionObserver 由浏览器通知「元素是否进入某个区域」，不必在每次 `scroll` 里自己量所有章节的位置。

```ts
const observer = new IntersectionObserver((entries) => {
  const current = entries.find((e) => e.isIntersecting);
  if (current) setActiveId(current.target.id);
}, { rootMargin: '-20% 0px -60% 0px' });
sections.forEach((section) => observer.observe(section));
```

`rootMargin: '-20% 0px -60% 0px'` 把判定用的视口从上方裁掉 20%、从下方裁掉 60%，剩下靠近上方的一条带。章节进入这条带才算「当前」。负的 margin 是在缩小观察根，不是把页面往上推。

示例只取第一个命中的章节。实际要规定：好几节同时可见时选哪一节。滚到页面底部时，最后几节可能不够高，进不了那条带，要单独处理。还要照顾键盘操作，以及系统「减少动画」开启时不要强行平滑滚动。组件卸载时 `disconnect()`，否则观察器还指着已经卸掉的节点。

## 顶部加载旧消息：插入之后把视口补回去

聊天列表向上翻旧消息时，新 DOM 插在现有内容上面。如果不补偿，用户正在看的那一行会被推下去。

接近顶部，或用户明确点击加载时，先看是不是已经在加载，或者已经没有更早的数据。是的话直接返回。再用游标请求更早的一页。游标是上一页最早一条的标识。插入前记下锚点：第一个可见消息，以及它相对容器的偏移。插入后按高度差改 `scrollTop`，让锚点留在原地。

游标比页码稳。中间插入了新消息，页码的边界会漂，游标仍表示「从这条再往前」。

`loading` 防止加载过程中再发一次。`hasMore` 在没有更早数据时停掉。

简单补偿是比较插入前后的 `scrollHeight`：

```ts
const before = list.scrollHeight;
await loadOlderMessages();
requestAnimationFrame(() => {
  list.scrollTop += list.scrollHeight - before;
});
```

这段假设 `await` 结束时，新 DOM 已经提交。在 React 里，fetch 完成不等于浏览器已经把新节点布局完。应在提交后的布局阶段，按锚点再补一次。图片若在稍后才加载、把高度撑开，还要再校正一次。

## 页签：看得见，和键盘打得进去，不是一回事

页签是否可见，看 `document.visibilityState`，取值是 `visible` 或 `hidden`，变化时听 `visibilitychange`。文档能否收到键盘，看 `document.hasFocus()`。

两个窗口并排时，页面可以可见但没有焦点。切到另一个浏览器页签，通常变成 `hidden`。

隐藏时可以暂停动画和非必要轮询，重新可见时补读期间错过的数据。隐藏不能当作「把后台任务停掉」的信号。任务如果跑在共享后台里，页签看不见它仍应继续。

浏览器会节流后台页签的定时器。靠页面心跳判断「用户还在看」时，要给登记一个有效期。否则节流造成的迟到会被当成用户已经离开，或者反过来永远不失效。

## 关闭页面不是可靠的保存点

浏览器可以杀掉进程，异步请求也可能来不及发完。重要内容在编辑过程中就逐步保存。

平时就保存。`visibilityState` 变成 `hidden` 时再补一次。移动端切走后进程随时可能被杀，这是较可靠的时机。`pagehide` 再补一次。页面卸载，或被放进往返缓存时，都会走到这里。`beforeunload` 只在确有未保存内容时用来询问「确定离开吗」。

`beforeunload` 不适合拿来做保存。关页时发出的异步请求未必完成。移动端进程被杀时，可能任何关闭事件都没有。

## 长文本：收起是视觉截断，原文还在

只有两个状态：显示前几行，或显示全文。收起用 CSS `line-clamp` 限制行数并出现省略号。DOM 里始终留着全文，复制才能拿到全文，而不是截断后的那几行。

是否溢出，用 `scrollHeight > clientHeight` 判断。没溢出就不显示按钮。容器宽度、字体或内容变了，要重新判断。

按钮加 `aria-expanded`，读屏软件才知道现在是展开还是收起。展开时尽量保住阅读位置。

## 拖拽：页面里的指针，和系统文件，是两套事件

拖动弹窗、拖分隔条改宽度，用 Pointer Events 和 `setPointerCapture`。把系统文件拖进页面，用 `drag` / `drop` 和 `DataTransfer`。

Pointer Events 把鼠标、触屏、触控笔收成一套指针事件。`pointerdown` 时记下起点和元素原位置，并 `setPointerCapture`。`pointermove` 时如果仍捕获着这支指针，用 `transform` 更新位置。`pointerup` 或 `pointercancel` 时释放捕获，清理状态。

不捕获的话，指针移出元素就收不到后续移动，拖得快时会丢。`transform` 不触发布局。改 `left` 或 `top` 会。移动很密时，用 `requestAnimationFrame` 把同一帧里的多次移动合成一次，并限制不越出边界。

移动超过几像素才算拖，否则一次点击也会被当成拖动。触屏上设置 CSS `touch-action`，避免浏览器把拖动手势当成页面滚动。重要操作同时提供键盘方式，例如方向键调宽度。

```ts
handle.onpointerdown = (e) => handle.setPointerCapture(e.pointerId);
handle.onpointermove = (e) => {
  if (handle.hasPointerCapture(e.pointerId)) resizeTo(e.clientX);
};
handle.onpointerup = (e) => handle.releasePointerCapture(e.pointerId);
```

## 尺寸：窗口、视口、某一个容器

窄屏换排版，用 CSS 媒体查询或容器查询，不必用 JS。窗口宽高的数值，听 `window` 的 `resize`，读 `innerWidth` 和 `innerHeight`。软键盘、缩放后的可视区域，看 `visualViewport`。某个元素自己变大变小，用 `ResizeObserver`。

`resize` 触发很密，用 `requestAnimationFrame` 把同一帧合并成一次更新。组件卸载时去掉监听。

侧栏展开后，窗口尺寸可以不变，中间的终端却变窄了。`window.resize` 不会响。这时观察那个容器：

```ts
const observer = new ResizeObserver(() => fitAddon.fit());
observer.observe(container);
```

回调里不要反复改被观察元素的尺寸，否则观察和修改会循环。必要时先比较新旧尺寸，把写操作放到下一帧。卸载时 `disconnect()`。

能用 CSS 完成的排版，不要用 JS 听尺寸再去改样式。

## 容易答错的地方

UA、视口、指针、特性检测，是四个问题，四种事实。

并排窗口可以看得见，但没有键盘焦点。可见和焦点不是一回事。

页签隐藏时，草稿要补存。共享后台里的任务不要因为页签隐藏就停。

Pointer Events 拖的是页面上的元素。`drag` / `drop` 接收的是操作系统拖来的文件。

`window.resize` 只有窗口变了才来。ResizeObserver 看的是元素盒子。

## 上篇里和 Moose 对得上的

Moose 用按钮加载更早的历史，不用靠近顶部自动加载。通知会把可见性、焦点和当前会话报告给共享后台，用来压住正在查看的会话的通知。焦点登记有有效期，因为后台页签可能推迟心跳。任务不随页签隐藏停止。关窗后共享后台还可以继续，崩溃恢复靠已经写入的记录，不靠窗口关闭回调。

文件和审阅共用一个右侧面板。拖宽度走 Pointer Events 和 `setPointerCapture`，并支持方向键。文件拖入输入区用 `DataTransfer.files`。终端用 ResizeObserver 调整大小。右侧面板的初始宽度按 `window.innerWidth` 算，窗口 resize 时重新限制面板宽度。没有把窗口尺寸持续上报出去。

工具和思考可以折叠，普通回答不会统一截成三行。折叠的元素在下篇。不要补一句「Moose 用了某种 UA 解析」。
