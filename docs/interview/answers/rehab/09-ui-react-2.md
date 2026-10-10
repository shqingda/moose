# 九、内容、布局与 React · 下

> 承接 [上篇](09-ui-react-1.md)。对应原题 27、28、36、37、41、49、50、60。
> 读完要能讲清：预览 PDF 时什么时候不必自己渲染；划词要保存的是哪一种位置；折叠怎样让键盘用户进不去隐藏内容；`flex: 1` 实际分配的是什么；列表的 key 和 Context 为什么会让状态或渲染「跑到别的组件上」。

## 1. PDF：先决定要不要统一的界面

「预览」可能只是让用户看，也可能要统一的页码、搜索和标注。

| 方案 | 适合 | 代价 |
| --- | --- | --- |
| 浏览器自带查看器，`iframe` 或新页签 | 点开就能看 | 各浏览器界面不统一，难定制 |
| PDF.js（Mozilla 的渲染库） | 要自己的页码、搜索、标注 | 开发和维护更重 |

需要登录才能下的文件，用受控地址或带凭证的请求去取，不要把长期有效的秘密放进一个谁都能打开的 URL。若用 `URL.createObjectURL` 生成临时地址，关闭预览时调用 `URL.revokeObjectURL`，否则 Blob 会留在内存里。

大文件只渲染看得见的页。还要处理跨域、按字节范围下载（Range）、缺字体、以及扫描件里没有可选文字。


## 2. 划词：浏览器选区，和编辑器里的位置

浏览器用 `window.getSelection()` 得到 Selection（当前选区），再用 `getRangeAt` 得到 Range。Range 由起点节点加偏移、终点节点加偏移组成，可以跨多个标签。`collapsed` 为真表示起点和终点重合，也就是没有选出文字。

自定义右键菜单：

```
在目标区域听 contextmenu
  → 有选区、不是折叠的、起点和终点都在目标里
  → 阻止默认菜单
  → 先把文字和位置存下来（一点菜单，选区可能就没了）
  → 菜单放在鼠标处或选区矩形处，并限制在视口内
  → Escape 能关掉，并提供键盘入口
```

```ts
const selection = window.getSelection();
const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
if (!range || range.collapsed || !root.contains(range.commonAncestorContainer)) return;
const selectedText = selection!.toString();
```

`commonAncestorContainer` 是包住整段选区的那个节点。它不在目标根里，说明选区越过了你的区域。

富文本编辑器内部另有文档模型：内容和格式的数据结构。加粗、评论都改模型，并进入撤销历史，而不是去拼 `innerHTML`。拼 HTML 会绕过模型和撤销。DOM 一旦重排，旧的 Range 会失效或指到别的字上。持久标注要保存模型中的位置或文字锚点，内容变化后按锚点重新定位。

这一题的答案没有写 Moose 的划词菜单。不要把它说成项目已有的功能。

## 3. 折叠：原生元素够用时，不必自己模拟按钮

折叠要同时满足：标题能用键盘操作，收起之后里面的按钮不能再被 Tab 到。否则键盘用户会走进看不见的区域。

不需要外部状态时，用原生元素：

```html
<details>
  <summary>工具调用详情</summary>
  <pre>执行结果…</pre>
</details>
```

浏览器自带基本语义和键盘操作。

需要「同时只展开一项」，或展开与否由外部状态决定时，用 `<button>` 当标题。`aria-expanded` 表示当前是否展开，`aria-controls` 指向那块面板。加动画时尊重 `prefers-reduced-motion`。


## 4. 一个节点在不在另一个节点里面

「点击外面就关闭」要判断点击目标是不是弹窗的后代。先分清深度：

| 你要的关系 | 写法 |
| --- | --- |
| 任意层后代，包含它自己 | `b.contains(a)` |
| 严格的后代，不含自己 | `b.contains(a) && a !== b` |
| 只是直接子节点 | `a.parentElement === b` |

`contains` 对自身返回 `true`。拿它当「在里面且不是自己」会把点在容器上的那一下也算成内部。

Shadow DOM 把组件内部的树封装起来。普通的 `contains` 可能看不到影子树里的节点。事件的 `composedPath()` 返回事件穿过的完整路径，包含影子树内部，这种时候改看路径。

**补充知识：** Shadow DOM 是组件把内部节点藏在一棵单独的树里，外面的选择器和普通包含判断默认进不去。答案提到它，是因为「点击是否在组件内」在用了 Web Components 时会踩到。

## 5. `flex: 1` 是参与分配剩余空间

Flex 布局先看每个子项的基础大小，再把多出来的或不够的空间分下去。`flex: 1` 改的是分配规则，不是写死一个宽度。

在常用实现里，它等价于 `flex: 1 1 0%`：

| 分量 | 值 | 含义 |
| --- | --- | --- |
| `flex-grow` | 1 | 有多余空间时可以长大 |
| `flex-shrink` | 1 | 空间不够时可以缩小 |
| `flex-basis` | 0% | 从 0 起参与分配，而不是从内容宽度起 |

几个子项都是 `flex: 1` 时，通常平分可分配空间。这不等于每一项都「占满父容器」。父容器只有一份空间，它们是在分这一份。

Flex 子项默认的最小尺寸是内容本身。一长串不换行的文本或一张宽表，会把列撑破。横向布局里给 `min-width: 0`，纵向滚动容器给 `min-height: 0`，它才被允许缩到比内容更小，多出来的交给 `overflow` 滚动。

```css
.sidebar { flex: 0 0 240px; }
.transcript { flex: 1; min-width: 0; overflow: auto; }
```

侧栏 `0 0 240px`：不长大、不缩小、基础就是 240px。主区占剩余，并且允许被长内容压到比内容更窄，然后在自己内部滚动。


## 6. key 是「这一项还是不是原来那一项」

React 每轮渲染用 key 把新旧列表对齐。key 相同，就复用那个组件实例和它里面的 state。

用数组下标当 key 时，在第一行插入一条，原来的第二行变成第三行。React 仍认为「key 为 1 的那一项还是那一项」，于是旧第二行的输入框内容、展开状态，会留在新的第二行上。状态跟着下标走，没有跟着消息走。

```tsx
messages.map((message, index) => <Row key={index} message={message} />)
messages.map((message) => <Row key={message.id} message={message} />)
```

用稳定的业务 ID。不要每次渲染都 `key={Math.random()}`：每一项都会被当成新元素，state 丢掉，DOM 也会整表重建。

流式更新应当改消息的内容，而不是换成一个新 ID。ID 一变，行就被卸载，里面的展开状态和代码块一起没了。这和流式章「保持渲染组件类型稳定」是同一目的。


## 7. Context 一变，读取它的组件都会更新

Context 把数据传给很深的子组件，不用一层层放 props。值变的时候，所有调用了 `useContext` 的组件都会重渲染。这是机制，不是故障。故障是把高频数据放进一个大家都读的 Context，导致不相关的组件跟着动。

减轻的办法：

```
高频（输入中的文字）和低频（主题、语言）拆成不同 Context
  → Provider 只包住需要这份数据的子树
  → 传给 Provider 的对象和函数用 useMemo / useCallback 保持引用
  → 还要按字段订阅时，改用带 selector 的 store
```

父组件每次渲染都写 `value={{ lang }}`，会得到一个新对象。即使用户没换语言，消费者也会更新。引用要稳定。

`memo` 挡不住组件自己读到的 Context。子组件只要调用了 `useContext`，那份值变了它就会渲染，不管外面包没包 `memo`。


## 8. 换肤：组件认语义，不认色值

要一起变的不只是背景，还有文字、边框、焦点和图表。颜色写死在每个组件里，换一套就要改很多处，还容易漏。

按语义定义变量，例如 `--surface` 是面板背景、`--text` 是正文，而不是 `--gray-900`。根节点切换 `class` 或 `data-theme`，组件只引用变量。

```css
:root { --surface: #fff; --text: #111; }
[data-theme='dark'] { --surface: #171717; --text: #eee; }
.panel { background: var(--surface); color: var(--text); }
```

保存用户的选择。system 模式用 `prefers-color-scheme` 跟随系统。在页面第一次画出来之前就加上主题，避免先白后黑。同时检查对比度、焦点样式和图表颜色。


## 容易混在一起

**浏览器 Range 和编辑器锚点。** 前者是当前 DOM 上的选区，一点就可能消失，DOM 一变也会失效。持久标注存后者。

**`contains` 和「是子节点」。** `contains` 含自身，也含孙子。直接子节点看 `parentElement`。

**`flex: 1` 和宽度 100%。** 前者是和兄弟一起分剩余空间，并且默许缩小。长内容仍可能因为最小尺寸是内容宽度而撑开，所以要 `min-width: 0` 或纵向的 `min-height: 0`。

**key 和下标。** 下标描述位置。ID 描述身份。插入删除之后，位置会换人。

**`memo` 和 Context。** `memo` 比较 props。Context 是组件自己订阅的，props 没变也会因 Context 更新。

## 本章速记

上篇选对观察信号，下篇选对「内容的身份」：

```
PDF 只是查看，就用浏览器；要统一界面再自己渲染，并释放 Blob
划词先确认选区在目标内，立刻保存文字；长期标注存模型位置
折叠优先 details/summary；受控时用按钮和 aria，收起后不能 Tab 进去
contains 含自身；直接子节点看 parentElement
flex: 1 是 1 1 0%，分的是剩余空间；滚动区还要 min-height: 0 或 min-width: 0
列表 key 用稳定 ID，流式更新不换 ID
Context 按变化频率拆开，值的引用要稳；memo 挡不住 useContext
主题用语义变量，手动选择盖过系统，首屏之前就生效
```

Moose 的 PDF 是认证后的下载和另存，不内嵌渲染器。工具和思考用 `details` 折叠。消息区有 `min-height: 0`，时间线的 key 是 `message.id`。语言放在 LocaleContext 里，主题是 system / light / dark，手动优先。划词菜单没有写在这组答案里，不要说成已实现。
