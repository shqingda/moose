# Moose 性能重构计划

只做代码与工程瘦身。不改功能，不改界面。

桌面端优先：主进程保持薄，重活后移，安装包里少装一份重复运行时，空闲内存按进程拆开看，冷启动按真实窗口和真实底座探测来测。Web 共用同一套后台和同一套界面资源，能一起瘦的一起瘦，不为了桌面去拆掉浏览器路径。

版本依据：`package.json` 为 `0.23.1`。体积用 [docs/releases/evidence/0.23.1/size.json](releases/evidence/0.23.1/size.json)。启动和内存用 [docs/releases/evidence/0.23.0/perf-after.json](releases/evidence/0.23.0/perf-after.json) 与 [0.23.0 验收](releases/0.23.0-validation.md)（0.23.1 明确沿用这组数，没有重测整机）。

本计划尊重 [架构说明第 14 节](architecture.md#14-维护与精简原则)：五层不动（界面、宿主传输、业务服务、代理适配器、存储）；桌面和 Web 继续共用一个 MooseService；不引入服务容器、事件总线，也不把后台拆成多个服务；不按行数拆 `service.ts` / `app.tsx`；延后加载不等于安装包少了同样多的字节。

## 1. 现状

### 1.1 已经做对的部分

这些保持，不要推倒重来。

- 进程已经分开。渲染进程开了 `sandbox`、`contextIsolation`，关了 `nodeIntegration`（[electron/main.ts](../electron/main.ts)）。预加载只有 [electron/preload.ts](../electron/preload.ts)（源码约 1 KB）。
- 窗口 `show: false`，要等 `ready-to-show` 和渲染进程 `moose:ready` 才显示。0.23.0 曾用根级 Suspense，隐藏欢迎页多了约 0.5 秒，已改成先解析宿主模块再挂载（[src/main.tsx](../src/main.tsx)）。
- 安装版后台用独立进程，关窗口任务还在。[electron/desktop-runtime.ts](../electron/desktop-runtime.ts) 以 `ELECTRON_RUN_AS_NODE=1` 拉起 `web-server.js`。开发和隔离测试仍走 utility process（[electron/runtime-host.ts](../electron/runtime-host.ts) → [electron/runtime.ts](../electron/runtime.ts)）。
- PTY 不在主进程里。终端会话才拉起 [electron/pty-host.ts](../electron/pty-host.ts)。`@xterm/xterm` 在 [src/components/terminal-view.tsx](../src/components/terminal-view.tsx) 里动态导入。0.23.1 产物里 `xterm-*.js` 为 331,178 字节，不在静态入口图里。
- 检查更新在菜单点击时才跑（[electron/updates.ts](../electron/updates.ts)），没有卡在启动路径上。
- 界面按使用再加载：时间线、文件、审阅、设置、搜索、终端、语法高亮语言包。0.23.0 把静态入口 JS 从 730,167 字节降到 223,759 字节。
- Pierre 已打补丁：只用 JavaScript 正则引擎和 GitHub 浅／深两套主题，去掉 WASM 入口（[patches/@pierre__diffs@1.5.1.patch](../patches/@pierre__diffs@1.5.1.patch)）。
- 原生模块已外置并解包：`better-sqlite3`、`node-pty` 在 Vite 里 `external`，electron-builder `asarUnpack` 含 `**/*.node` 和 `**/node-pty/**`。
- `electronLanguages` 已从「全部 Chromium 语言」收成 12 个英文／简中条目，而不是默认的全量 locale pak。

### 1.2 包有多大

0.23.1 `pnpm size:measure` 口径：普通文件长度之和；入口是静态 import 图，不是网络瀑布。

| 产物 | 字节 | 约 |
| --- | ---: | --- |
| `dist/` 全部 | 10,555,815 | 10.1 MiB |
| 静态入口 JS | 223,759（gzip 69,930） | 入口已经轻 |
| 按需 JS | 10,119,847，268 个文件 | 几乎整个前端 |
| macOS App | 268,103,987 | 256 MiB |
| DMG | 121,471,001 | 116 MiB |
| 独立 Web 包 | 42,654,299 | 40.7 MiB |

0.23.0 相对 0.22.1：前端资源 −7.6%，入口 JS −69%，欢迎图从 926,074 字节降到 59,516 字节；桌面 App 只 −0.3%（268,970,427 → 268,102,357）。界面分包几乎没有改变 DMG。桌面体积的大头是 Electron 本身，不是业务 JS。

`dist/` 里大约 7.9 MiB、242 个 JS 文件是语法包和图标碎片，不是壳。最大的几个：`emacs-lisp` 790,000、`cpp` 785,541、`wolfram` 262,384、`vue-vine` 190,058、`angular-ts` 183,731、`typescript` 181,146。它们按需加载，空闲时不进 JS 堆，但打进 asar，也打进 Web 压缩包。

欢迎路径（0.23.0 Web 测量，解码后约 945 KB，传输约 367 KB）实际会拉：

| 资源 | 解码字节 |
| --- | ---: |
| `index-*.js` | 223,043 |
| `app-*.js` | 250,940 |
| `field-*.js` | 165,446 |
| `index-*.css` | 144,400 |
| `button-*.js` | 79,423 |
| 欢迎图 | 59,516 |
| `web-host-*.js` | 10,880 |

`src/components/ui/field.tsx` 本身很小，165 KB 的 `field` chunk 不可能只是这个文件。先用分析器看它实际卷进了什么，再决定动不动。

### 1.3 启动和内存：数字不能直接当成「独占内存」

0.23.0 打包桌面、隐藏窗口、磁盘热缓存、空数据、测量前关掉四家底座，三次：

| 就绪 | 进程树 RSS | 渲染进程 JS 堆 |
| ---: | ---: | ---: |
| 582 ms | 559 MiB | 5.4 MiB |
| 566 ms | 559 MiB | 5.3 MiB |
| 602 ms | 559 MiB | 5.3 MiB |

脚本 [scripts/measure-performance.ts](../scripts/measure-performance.ts) 把桌面进程和后台服务进程以及它们的子进程 RSS **加总**。验收写明：RSS 含共享页，不能当成独占物理内存；JS 堆下降也不等于整机内存下降。欢迎图解码从约 6 MiB 降到 324 KiB，RSS 只从约 566 MiB 到 559 MiB。

因此：再砍前端语法包，主要减小 DMG／Web 包和「打开该语言文件时」的内存，**几乎不会**让活动监视器里的空闲占用从 559 掉到 200。空闲时 JS 堆只有约 5 MiB。要让桌面「重新变轻」，得先把这 559 拆成主进程、GPU、渲染进程、`ELECTRON_RUN_AS_NODE` 服务进程各自的物理占用，并且补上现在没测的两种情况：磁盘冷缓存，以及底座探测开着。

### 1.4 桌面主进程并不厚，但启动时仍做了不该占满第一秒的事

[electron/main.ts](../electron/main.ts) 源码约 17 KB。模块一加载就构造 runtime：安装版会开始拉后台。这和开窗口是重叠的，方向对。

紧接着的问题：

1. **两份后台打进桌面 asar。** [vite.config.ts](../vite.config.ts) 构建 `main`、`preload`、`runtime`、`pty-host`、`web-server` 五个入口，且 `codeSplitting: false`。每个入口打成单文件。`runtime.ts` 和 `web-server.ts` 都静态依赖 `MooseService`。electron-builder 的 `files` 收录整个 `dist-electron/**`。安装版实际只跑 `web-server.js`（[desktop-runtime.ts](../electron/desktop-runtime.ts)）。Web 打包脚本只复制 `dist-electron/web-server` 和 `pty-host`（[distribution/scripts/package.mjs](../distribution/scripts/package.mjs)）。桌面包多带了一份本地 utility 入口。`MOOSE_RUNTIME_MODE=local` 仍会用到 `runtime.js`，所以是「测量后决定 dmg 是否还带」，不是直接删源码入口。
2. **四家适配器静态打进每一个后台包。** [electron/providers/registry.ts](../electron/providers/registry.ts) 顶层 import Codex、Grok、Pi、OpenCode。Grok 值导入 `@agentclientprotocol/sdk`（[electron/providers/grok.ts](../electron/providers/grok.ts)）。`codeSplitting: false` 让这些无法再拆。服务进程在监听端口之前就要解析全部协议代码。
3. **欢迎页一挂上就 `providers` 且 `refresh: true`。** [src/app.tsx](../src/app.tsx) 的 `connect()` 在工作区 effect 里无条件调用。服务端 [electron/provider-registry.ts](../electron/provider-registry.ts) 会并行 `discover` + `probe`，探测会起 CLI 进程。现有性能样本在测量前把四家关掉了，所以 559 MiB / 约 580 ms **不包含**真实探测。快照本身（[electron/service.ts](../electron/service.ts) 的 `snapshot`）不探测 CLI，只读 SQLite。
4. **主进程静态链上有 zod。** `main.ts` import [shared/validation.ts](../shared/validation.ts)（约 14 KB 源码，`import { z } from 'zod'`）。IPC 必须校验，不能拿掉校验；可以让主进程只保留薄校验，把大 schema 留在已经要跑的服务进程里。这只影响桌面主进程解析时间。
5. **Codex 生成类型不该进包。** `electron/providers/generated` 约 3.6 MB、861 个文件，引用都是 `import type`。确认产物里没有这些字符串即可，不要为了体积去删生成源码。

### 1.5 卡顿更可能出在打开功能之后，而不是空欢迎页

- 时间线没有虚拟列表。已有：每页 80 条、`content-visibility: auto`、行 `memo`、流式合并不整表排序（[src/lib/transcript-messages.ts](../src/lib/transcript-messages.ts)、[src/components/ui/message-scroller.tsx](../src/components/ui/message-scroller.tsx)）。0.23.0 微基准把 2000 次末行合并从 937 ms 降到 4 ms，这只说明合并函数，不是帧率。
- Markdown 走 `react-markdown` + `remark-gfm` + `rehype-highlight`（[src/components/markdown.tsx](../src/components/markdown.tsx)）。`highlight.js` 在依赖里是 11.12.0。对应产物 `markdown-*.js` 约 326 KB，在打开会话后才加载。默认 rehype 插件会登记一整套语言；界面上的语言名表只覆盖常见语言。长回答流式增长时，整段重解析比包体积更影响顺滑。
- 只读源码面板 [src/components/code-preview.tsx](../src/components/code-preview.tsx) 约 568 KB，再加上该语言的语法包（C++ 单包就 786 KB）。空闲不付这笔账，打开大文件时付。
- 壳上的弹簧来自 `motion/react`（[src/app.tsx](../src/app.tsx)、[src/lib/workspace-layout.ts](../src/lib/workspace-layout.ts)）。这是现有交互，不删。
- 侧栏 `vibrancy: 'sidebar'`、透明背景、`spellcheck: true` 会占用 GPU 和字典。改它们会改变外观或输入行为，本计划不动。只在测量里单列，供以后单独决定。

### 1.6 源码里重、但多数没进安装包的东西

- `src/assets` 约 8.3 MB，多是图标母图。应用产物只收 `moose-logo-welcome.png`（59,516 字节）。官网 [distribution/site/src/routes/index.tsx](../distribution/site/src/routes/index.tsx) 引用了约 1.4 MB 的 `moose-icon-black.png`。那是站点，不是桌面 asar，也不在本计划的 P0。
- `src/lib/i18n.tsx` 约 35 KB，两种语言都在壳上。收益小。
- 样式源码合计约 77 KB，产物 `index-*.css` 144,400 字节。Tailwind 已经按内容扫描。没有分析器结果之前，不做大规模清类名。

## 2. 参考谁，以及不照搬什么

只借和 Moose 现有形状对得上的做法。星数是 2026-10-09 的 GitHub 数字，用来说明社区分量，不是质量排序。

| 仓库 | 星 | 借的模式 | 为什么适合 Moose | 明确不借 |
| --- | ---: | --- | --- | --- |
| [microsoft/vscode](https://github.com/microsoft/vscode) | 193,493 | 主进程生命周期分相：窗口打开前只做开窗必需的事；`AfterWindowOpen` 做随后的事；`Eventually`（约 2.5–5 秒且空闲）再做其余的。[lifecycleMainService.ts](https://github.com/microsoft/vscode/blob/main/src/vs/platform/lifecycle/electron-main/lifecycleMainService.ts)、[app.ts](https://github.com/microsoft/vscode/blob/main/src/vs/code/electron-main/app.ts)。跨进程 `performance.mark`，以及 `--prof-startup` 同时抓主进程和渲染进程。[性能工具 wiki](https://github.com/microsoft/vscode/wiki/%5BDEV%5D-Perf-Tools-for-VS-Code-Development) | Moose 已经是「主进程 + 渲染进程 + 独立后台 + 按需 PTY」。缺的是分相和分进程计时，不是再做一个扩展宿主 | 贡献点系统、扩展宿主、整套依赖注入。共享进程用 utility process 是因为 VS Code 关窗即退；Moose 关窗任务还在，所以安装版继续用独立进程，不改成 utility process |
| [alex8088/electron-vite](https://github.com/alex8088/electron-vite) | 5,624 | main / preload / renderer 分开构建；原生模块 external；预加载保持单文件、不把渲染依赖卷进主进程。[文档中的三入口配置](https://github.com/alex8088/electron-vite) | 当前就是 `vite-plugin-electron` 的五入口，external 已经只留 `electron`、`better-sqlite3`、`node-pty`。要修的是服务入口 `codeSplitting: false` 把四家适配器焊死 | 不为了换工具而迁到 electron-vite。字节码保护与体积、内存无关 |
| [toeverything/AFFiNE](https://github.com/toeverything/AFFiNE) | 73,346 | 桌面工程分成 `main` / `preload` / `helper` / `shared`。重活放进 `utilityProcess`（[helper-process.ts](https://github.com/toeverything/AFFiNE/blob/main/packages/frontend/apps/electron/src/main/helper-process.ts)），窗口进程不持有工作区引擎 | 开发和测试路径已经有 utility process。可对齐的是「主进程文件保持窗口、协议、IPC」，而不是再造一个 helper | 不引入他们的块编辑器、Yjs，也不把安装版服务改成随窗口死亡的 utility process |
| [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) | 133,549 | `manualChunks` 时避免把共享依赖用静态 import 再吊回主包，否则懒加载失效（[excalidraw-app/vite.config.mts](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/vite.config.mts) 附近注释） | 用来检查 `field` / `button` 这种大 chunk 是不是把壳和懒模块又缝在一起。欢迎路径解码约 945 KB，值得看，但不是 268 MB App 的原因 | 不拆成他们那种多包仓库。Moose 没有这个规模的问题 |
| [shikijs/shiki](https://github.com/shikijs/shiki) | 13,859 | 细粒度包：懒加载的语法文件仍然占 dist；性能敏感时用 `shiki/core` 按语言组合，而不是默认全量（[bundles.md](https://github.com/shikijs/shiki/blob/main/docs/guide/bundles.md)） | 补丁已经走到 `shiki/core` + JS 引擎。还没做的是：全语言加载器仍进安装包。文档写明不能靠删语言来追数字（[development.md](development.md#资源与包体积)）。借的是「按需组合」，不是「只留三种语言」 | 不改成远程拉语法。高亮必须离线 |
| [laurent22/joplin](https://github.com/laurent22/joplin) | 56,645 | 反面： [packages/app-desktop/main.ts](https://github.com/laurent22/joplin/blob/dev/packages/app-desktop/main.ts) 在开窗前做 profile、桥、文件系统，并 `require('@electron/remote/main')` | 用来约束 Moose：主进程不要再变厚，尤其不要引入 `@electron/remote` 把 Node 能力漏回渲染进程 | 不学他们的启动顺序 |
| [logseq/logseq](https://github.com/logseq/logseq) | 45,188 | 反面： [resources/electron-builder.yml](https://github.com/logseq/logseq/blob/master/resources/electron-builder.yml) 用 `**/*` 再逐条排除 map、测试、`.d.ts` | Moose 的 `files` 已经是白名单（`dist`、`dist-electron`、`package.json`、原生模块裁剪）。保持白名单，只把白名单里重复的 `runtime` 产物拿掉 | 不把整个仓库打进 asar |

[electron/electron](https://github.com/electron/electron)（123,247 星）里 Moose 已经在用的：上下文隔离、沙箱、原生模块 asarUnpack、先隐藏再显示。不再加一层「单进程模式」或关掉沙箱来省内存，那会换来卡顿和安全回退。

## 3. 工作流

影响列：体积 = 安装包或 asar；内存 = 空闲物理占用或打开某功能时的峰值；启动 = 到窗口可见且欢迎页可操作；顺滑 = 滚动、流式输出、开面板时的掉帧。

### P0 — 先让桌面的账算得清，并去掉启动路径上的重复解析

| 项 | 做什么 | 体积 | 内存 | 启动 | 顺滑 | 端 | 风险 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P0-1 分进程测量 | 扩展 `pnpm perf:measure`：主进程、GPU、渲染进程、服务进程分开报 RSS，并在 macOS 上加物理足迹（`footprint` 或等价），避免把共享页加总当成独占。同一脚本增加：可见窗口、磁盘冷缓存、四家底座保持开启。打点对齐 VS Code 的分相：主进程 `will-finish-launching` → `ready` → `loadURL` → `ready-to-show` → 渲染 `moose:ready`；服务进程从 spawn 到写出 `connection.json`，再到首个 `snapshot` 返回。底座探测单独记开始和结束 | 无 | 搞清 559 MiB 落在谁身上。这是后面所有内存结论的前提 | 分出「开窗」和「探测 CLI」 | 无 | 桌面为主；Web 用现有 `pnpm perf:web`，补服务进程自己的 RSS | 低。只加测量，不改行为。样本仍要写清条件，不能和 0.23.0 的隐藏热缓存数字直接比绝对值 |
| P0-2 桌面 asar 不要打两份后台 | 打包文件列表与 Web 对齐：dmg 需要 `main`、`preload`、`web-server`、`pty-host`。先量 `dist-electron/runtime` 和 `dist-electron/web-server` 的字节。若高度重复，安装包省略 `runtime`，源码和开发用的 utility 入口保留。`MOOSE_RUNTIME_MODE=local` 若仍是安装版的支持路径，则不能省，改为两入口共享一块已拆分的服务 chunk | asar 少一份完整服务图。量完才写百分比 | 不降低空闲 RSS（没运行的文件不占堆） | 不改变已安装应用的解析，除非安装版误加载了 runtime | 无 | 桌面 | 中低。漏带 `runtime.js` 会让显式 local 模式起不来。用现有打包冒烟覆盖默认共享模式；local 模式若保留，就继续带上 |
| P0-3 适配器改动态 import | 只对 `runtime` 和 `web-server` 打开 code splitting。`registry.ts` 按 provider `import()` Codex／Grok／Pi／OpenCode。预加载保持单文件 CJS，主进程保持现在的 external。借 VS Code「用到再加载」和 electron-vite「入口隔离」，不换构建工具 | 服务包变小，重复的协议代码不再焊进一个文件 | 空闲服务进程少解析 ACP SDK 和另外三家适配器。幅度取决于 P0-1 里服务进程的基线，预期是数十 MB 内，不是把 559 砍半 | 监听端口前少解析 JS。首条消息或首次探测把成本挪到第一次使用 | 无，只要探测仍可并行 | 桌面和 Web 的后台 | 中。第一次切到某家底座会多一次加载。探测、取消、关进程的测试要盖住四家。不要为了拆分去改 MooseService 的职责 |
| P0-4 探测挪出第一秒 | 快照返回后窗口就可以用。`connect()` 的 `refresh: true` 改到首帧之后的空闲时间（VS Code 的 Eventually：短延迟 + 空闲），而不是工作区 effect 一挂上就跑。界面仍会更新模型列表，只是不跟开窗抢 CPU。若已有探测结果，先显示上一次，再在空闲刷新。没有持久缓存就不要假装有；不要为了这个新做一套设置 UI | 无 | 空闲早期少一批 CLI 子进程。这是「底座开着」时才看得到的差，0.23.0 样本看不出来 | 欢迎页少和探测抢主线程／磁盘 | 开窗后 1 秒内少掉帧 | 两端。逻辑在 `app.tsx`，执行在共用服务 | 中。模型选择器可能晚几百毫秒到两秒才填满。不改变可选模型的集合，不改权限。要用现有提供者测试保证最终列表一致 |

P0 做完再看内存。若服务进程只占几十 MB，而渲染 + GPU 占了绝大部分，就停止在后台 JS 上继续期待空闲 RSS 大降，把 P1 转到「打开功能时的峰值」和「第二次启动」。

### P1 — 主进程再薄一点，第二次启动更快，打开重功能时少付一点

| 项 | 做什么 | 体积 | 内存 | 启动 | 顺滑 | 端 | 风险 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1-1 主进程里的 zod | 用分析器看 `dist-electron/main`。若 zod 和整份 `validation.ts` 占了主包的大头：主进程保留来源 frame 检查和一份更小的参数闸门，完整 schema 仍由服务执行（服务本来就会 `validate`）。借 electron-vite 的「主进程不要卷渲染／业务依赖」，不借 Joplin 的厚 main | 主 asar 入口变小 | 主进程少一份 zod 堆。相对 Chromium 很小 | 主进程解析变短，窗口 `loadURL` 更早 | 无 | 桌面 | 中。闸门变松会变成安全问题。帧校验和「不可信 IPC 直接拒绝」保持原样。差异要用现有 IPC 测试锁住 |
| P1-2 V8 代码缓存 | 渲染窗口设置代码缓存，使第二次启动不必重新编译欢迎路径那约 736 KB JS（0.23.0 解码 JS 量级）。VS Code 会把缓存放进用户数据目录并在启动配置里看缓存是否命中。先只做渲染进程，不碰业务代码 | 无，缓存写在用户目录 | 无显著空闲下降 | 第二次及以后的冷解析变短。第一次不会变快 | 二次打开后少编译卡顿 | 桌面 | 低。确认开发模式仍可调试。测一次缓存命中和缓存损坏后的回退 |
| P1-3 欢迎路径上的大 chunk | 对渲染构建跑分析器，解释 `field-*.js`（165,446）和 `button-*.js`（79,423）为何出现在欢迎导航里。若是共享依赖被命名成了入口模块，按 Excalidraw 的警告调整拆包，让壳只留下真正的壳。不替换 Base UI，不改样式 | 欢迎相关 JS 若把懒模块吊进来了，可以降；若本来就是壳上的 Base UI，则降不动 | 壳的解析内存，堆本身已经只有约 5–8 MiB | 少解析才能看见，预期是几十毫秒级，要用标记证明 | 无 | 两端 | 中低。拆错会把懒加载打回主包（0.23.0 入口曾是 730 KB）。用 `size:measure` 的入口图做守门 |
| P1-4 Markdown 高亮按语言加载 | `rehype-highlight` 改为 `highlight.js/lib/core`，见到代码块再加载对应语言，而不是在 326 KB 的 markdown 块里登记全部语言。可见结果用固定夹具对比：界面点名的 js/ts/py/sh/json/html/css/sql/md/yaml 必须同色。其余语言也要能上色，只是第一次遇到才加载。借 Shiki 细粒度，不删语言 | markdown 初始块下降；语言文件仍在包里，总 dist 不一定降 | 打开会话时少登记用不到的语法 | 无，会话本来就是懒的 | 长会话第一次出现代码块时少做无用登记 | 两端 | 中。颜色回归要用快照或夹具，不能靠目测一句。不要改复制、换行、流式不卸载代码块这些 0.23.1 已经守住的行为 |
| P1-5 语法包的打包策略，而不是删语言 | 保持「打开文件才加载该语言」。在此之上二选一，先量再定：把语法 chunk 留在 asar（随机读取，不影响空闲 RSS），或放到 asar 外的资源目录，缩短 asar 索引。Web 包对这约 7.9 MiB 原始语法更敏感（整包 42.7 MiB，且含一份 Node）。不改成 `shiki/bundle/web` 那种功能裁剪，除非另有「允许的语言表」并且离线夹具通过。与 [development.md](development.md#资源与包体积) 一致：升级依赖时重审补丁，不靠删语言追数字 | Web 压缩包和 DMG 里的 JS。桌面 App 268 MiB 里这只是小头 | 只影响打开该语言时的峰值。高亮器会缓存已加载语言；若一次审阅加载了 C++ 和 TypeScript，峰值是那些包之和 | 无 | 打开大语法文件时的停顿。不要在滚动路径上同步编译多门语言 | 两端，Web 更值 | 中。asar 外置要改 `moose://` 和 [electron/web-assets.ts](../electron/web-assets.ts) 的读取根，路径错了就是离线高亮坏。不做「只留十种语言」 |
| P1-6 locale 再核对一次 | 安装好的 `Moose.app` 里列出 `*.lproj` / locale pak。`electronLanguages` 含 `en_FEMININE` 这类键。若构建结果里没有对应文件，把列表收成真实存在的 `en` 与 `zh_CN`（是否保留 `en_GB` 看包里有没有）。已经不是全量语言，这项预期只有很小的字节 | 若还有多余 pak，通常是数 MB 级；若已经没有，就是零 | 无 | 无 | 无 | 桌面 | 低。少语言包不会改 Moose 自己的中英文案 |

### P2 — 有剖面再做，不做预防性大手术

| 项 | 做什么 | 预期 | 端 | 风险 |
| --- | --- | --- | --- | --- |
| P2-1 长会话顺滑 | 用性能面板录「万行里滚动」和「一条长回答连续 token」。只有当布局／绘制或 Markdown 解析占满帧，才在现有 `content-visibility` 之上加离屏纯文本或虚拟列表。虚拟列表会破坏页内查找和焦点，架构说明里已经把这个代价写明。默认不做 | 顺滑。不减安装包，不减空闲 RSS | 两端 | 高。滚动位置、流式增高、搜索跳转都容易坏。要有前后帧时间，而不是「感觉更流畅」 |
| P2-2 图标请求合并 | `lucide-react` 已经按图标拆，产物里有 195 字节一级的碎片。桌面走 `moose://` 影响小。Web 在本地也还好。只在分析器显示请求数造成打开面板停顿时，把首屏用到的图标收成少量块 | 顺滑／Web 请求数。外观不变 | Web 略多于桌面 | 低 |
| P2-3 文案按语言拆 | `i18n.tsx` 两种语言都进壳。拆成按 `zh-CN` / `en` 动态 import | 壳上大约几十 KB。启动几乎看不出来 | 两端 | 低。闪一下英文再变中文就不算成功 |
| P2-4 快照少读一次会话表 | `snapshot` 里 `listSessions()` 调用了两次（列表本身，以及活动映射又列一次） | 会话很多时少一次同步 SQL。空库无感 | 两端后台 | 低 |
| P2-5 站点大图 | 官网入口引用约 1.4 MB PNG。与桌面无关。若做站点构建，再单独压图 | 只影响站点 | 站点 | 低，且不在本次桌面目标里 |

不做的「优化」：关掉硬件加速（省 GPU 进程，但更容易卡）、单进程模式、去掉沙箱、去掉毛玻璃或弹簧、把安装版服务改回随窗口退出的 utility process、用系统 Node 再打进 dmg 去替换 `ELECTRON_RUN_AS_NODE`（包会变大，RSS 未必降，还多一个要签名的二进制）。

## 4. 明确不做

- 不改功能：底座种类、审批、终端、Git 审阅、worktree、调度、通知、搜索、文件面板、Web 与桌面共用数据，都保持。
- 不改界面：布局、文案、颜色、圆角、弹簧、毛玻璃、模糊、对比度、减少动态效果。侧栏震动效果和拼写检查只测量，不改。
- 不改数据库格式，不改任务在关窗口后继续跑的生命周期。
- 不把扩展登录从现有组件里拆出去。架构说明写了：拆出去登录做到一半会丢。
- 不按行数拆 `service.ts` 和 `app.tsx`。只有适配器加载方式这种能单独测试的边界才动。
- 不引入第二套服务、事件总线或微服务。
- 不换 UI 库，不换状态库，不换打包器品牌（继续 Vite + `vite-plugin-electron` + electron-builder）。
- 不删除语法语言来换一个更好看的体积数字。
- 不把 0.23.0 的隐藏窗口、热缓存、底座关闭样本，说成用户冷启动。

## 5. 顺序和怎么记一笔账

每一步都先有数字再改。沿用现有脚本，不发明第二套口径。

1. **基线（P0-1）**  
   - `pnpm size:measure`：继续报入口／懒加载／App／DMG／Web。额外记下 `dist-electron/*` 每个入口的字节，以及 asar 内 `dist` 与 `dist-electron` 各占多少。  
   - `pnpm perf:measure`：在现有三次之外，分进程 RSS + 物理足迹；一组保持今天的条件以便和 582/566/602 ms、559 MiB 对照；一组可见窗口、冷缓存、底座开启。  
   - `pnpm perf:web`：保持三次无 HTTP 缓存。另记服务进程单独的 RSS。  
   - 渲染构建打开包分析器（`rollup-plugin-visualizer` 一类，只在测量时用，不进生产依赖也可以）。同时看 `dist-electron/main/main.js` 和 `web-server.js`。

2. **快赢，桌面包和启动路径（P0-2、P0-3、P0-4）**  
   每项单独提交、单独再测。守门：入口 JS 不得回到 0.23.0 之前的 730 KB；欢迎页资源不得把语法包拉进静态图；四家探测的最终结果与现在一致；隐藏窗口样本的就绪时间不比 0.23.0 的约 600 ms 更差（允许噪声，看三次而不是一次）。

3. **主进程与第二次启动（P1-1、P1-2）**  
   对比主包字节，以及第二次启动的 `loadURL` → `moose:ready`。第一次启动不拿来声称缓存胜利。

4. **壳和 Markdown（P1-3、P1-4）**  
   用入口图和欢迎路径传输字节。高亮用夹具，不用截图感觉。

5. **语法包放置（P1-5、P1-6）**  
   只在 P0 证明空闲 RSS 不再受 JS 解析支配之后做。报告 DMG、Web 包、以及「打开一个 C++ 文件」前后的渲染进程物理足迹。

6. **长会话（P2-1）**  
   没有帧记录就不做虚拟列表。

建议记在和 0.23.0 相同的证据目录习惯里：条件、三次样本、脚本版本、和上一列的差。不要只报最快的一次。

## 6. 快赢和深改

**快赢（动构建图和启动时机，不动界面）**

- 量 asar，桌面不要装两份后台。
- 服务入口打开拆包，四家适配器动态 import。
- 底座探测挪到首帧之后的空闲。
- 核对 locale pak 是否还有多余键。
- 确认生成的 Codex 类型没有进 `dist-electron`。

这些对 DMG 是小头（App 仍约 256 MiB，因为 Chromium 还在），对「开窗那一秒服务进程在解析什么」是直接的。空闲 RSS 是否下降，完全看 P0-1 拆开的数字。

**深改（有剖面才做）**

- 主进程校验与服务校验的边界收薄。
- 渲染进程代码缓存和第二次启动。
- 欢迎路径 chunk 为什么叫 `field` 却有 165 KB。
- highlight.js 按语言加载，以及语法包放在 asar 内还是外。
- 长会话是继续靠 `content-visibility`，还是上虚拟列表。虚拟列表是最后手段。

**不要指望的事**

把前端从 10.6 MB 再砍到 3 MB，不会让 268 MB 的 App 或约 559 MiB 的进程树 RSS 变成一个「轻量原生应用」。轻，来自更少的进程工作、更晚的 CLI 探测、更少的主进程依赖，以及一次诚实的分进程内存数字。界面保持现在这样。
