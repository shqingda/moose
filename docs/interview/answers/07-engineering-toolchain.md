# 七、AI 工程化与前端工具链

> 本章 6 题，题号沿用原题号。每题按“这题在考什么 → 一句话回答 → 展开说明 → 示例 → Moose 里的做法 → 容易答错的地方”排列。[题目列表](../questions.md) ｜ [答案目录](README.md)

## 2. 现在怎样搭一套前端代码规范和提交检查？ESLint、Prettier 之外还有什么选择？

> **这题在考什么**：代码规范不是一个工具能搞定的：有的工具检查类型，有的找潜在错误，有的只统一空格和换行。近几年工具也在换代，配置格式变了，还出现了用 Rust 写的更快的替代品。面试官想看你知道各类工具管什么、怎样在本地提前反馈，以及为什么最终要靠 CI 把关。

**一句话回答**：类型检查用 `tsc --noEmit`，lint 用 ESLint 9 的 flat config 或更快的 oxlint、Biome，格式化用 Prettier 或 oxfmt、Biome；Git Hook 配合 lint-staged 只检查暂存的文件，给出快速反馈，CI 再跑完整的一组检查兜底；提交信息规范按团队需要决定。

**展开说明**

| 工具类别 | 管什么 | 常见选择 |
| --- | --- | --- |
| 类型检查 | 类型是否匹配 | TypeScript（`tsc --noEmit`） |
| Lint | 潜在错误和不良写法 | ESLint、oxlint、Biome |
| 格式化 | 空格、换行、引号等风格 | Prettier、oxfmt、Biome |
| Git Hook | 提交前在本地自动运行检查 | husky、lefthook，配合 lint-staged |
| 提交信息检查 | 提交说明是否符合约定 | Commitlint（可选） |

- ESLint 9 默认使用 flat config，也就是一个 `eslint.config.js` 文件导出配置数组，取代了以前的 `.eslintrc` 层层继承。新项目直接按这种格式写。
- oxlint、oxfmt（Oxc 项目）和 Biome 用 Rust 编写，速度比 ESLint、Prettier 快很多，适合大仓库。代价是规则和插件生态没有 ESLint 全，迁移前要确认团队依赖的规则都有对应实现。
- 需要类型信息的检查（比如参数类型不匹配）仍以 TypeScript 编译器为准，lint 工具不能替代 `tsc --noEmit`。
- Hook 只跑暂存的文件（lint-staged 做的就是这件事），否则每次提交都检查全仓库，太慢大家就会绕过去。
- `git commit --no-verify` 可以跳过 Hook，所以 Hook 只是提前反馈，真正的门槛是 CI 上同一组检查必须通过才能合并。
- 生成的代码和构建产物要排除在检查之外；lint 和格式化工具的规则冲突要先解决，比如关掉 lint 里管格式的规则。

**示例**：下面是一个 ESLint 9 flat config 的最小写法（示意）。

```js
// eslint.config.js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/**', 'src/generated/**'] }, // 构建产物和生成代码不检查
  js.configs.recommended,
  ...tseslint.configs.recommended,             // TypeScript 推荐规则
];
```

**Moose 里的做法**：Moose 没有用 ESLint 和 Prettier，而是用 oxlint 和 oxfmt。`package.json` 里 `pnpm lint` 运行 `oxlint .`，`pnpm format:check` 运行 `oxfmt --check .`，类型检查是 `pnpm typecheck`（`tsc --noEmit`），`pnpm build` 也会先跑 `tsc --noEmit` 再 `vite build`。`.oxlintrc.json` 启用了 typescript、unicorn、oxc 插件，把 correctness 类规则设为错误，并忽略 `electron/providers/generated/**`；`.oxfmtrc.json` 规定行宽 100、单引号、保留分号和尾随逗号。仓库里没有 husky、lefthook、lint-staged 或 Commitlint，也没有 `.github/workflows`。这些检查平时靠手动运行，发布时由 `pnpm release:prepare`（`scripts/release.mjs`）依次执行 `format:check`、`lint`、`test`、`build` 和 E2E，任何一步失败就不打包。

**容易答错的地方**
- 不能把题目里的 ESLint、Prettier、Commitlint 都说成 Moose 已经在用，也不能说 Moose 有 Git Hook。
- 以为换成 oxlint 或 Biome 就不需要 `tsc` 了。它们不做完整的类型检查。
- 只靠 Hook 把关。Hook 能被跳过，CI 才是硬门槛。

## 4. 设计一个 AI 前端项目的 CI/CD 流水线，包括代码检查、单元测试、E2E 测试、构建优化、自动部署。

> **这题在考什么**：CI/CD 是从提交代码到产出可安装版本的一连串自动检查和构建。关键不是列一堆工具名，而是让有问题的代码在发布前被拦住，并且能说清最终产物对应哪个提交。

**一句话回答**：PR 阶段跑类型、lint、单测、构建和关键 E2E；发布阶段只使用通过验证的提交和制品，并记录版本、签名和回滚方式；真实模型测试单独受控执行。

**展开说明**
- PR 阶段先锁定依赖，再依次跑类型检查、lint、单元测试、构建和关键 E2E（模拟用户操作的端到端测试）。
- 发布阶段只使用已经通过验证的提交和制品（构建产出的安装包等文件），并记录版本、签名和回滚方式。
- 调用真实模型的测试要单独、受控地执行，避免每个 PR 都受登录状态、额度和网络波动影响。

**Moose 里的做法**：Moose 已有可执行的联合发布脚本。`release:prepare` 检查并打包桌面与 Web，记录当前提交；`release:publish` 核对版本、提交和校验值，上传草稿、部署 Web，再从公网安装验证，通过后才公开 Release。

**容易答错的地方**
- 这是显式运行的发布流程。不能仅凭脚本存在，就声称每次 push 都会自动上线。
- 两端发布不是跨 GitHub 与 Cloudflare 的原子事务，可能一端成功、另一端失败。

## 6. AI 应用怎样监控页面体验（LCP、INP、CLS）和模型响应（首字时间、生成耗时）？

> **这题在考什么**：用户觉得“慢”，可能是页面半天不出现、点击没反应，也可能是模型迟迟不出第一个字。这些发生在不同阶段，混成一个总耗时就找不到瓶颈。面试官想看你能否分阶段测量。

**一句话回答**：页面体验用 LCP、INP、CLS 衡量，模型响应单独记录首字时间和总耗时，并区分工具执行、审批等待和模型生成，按分位数和失败率分析。

**展开说明**

| 指标 | 衡量什么 |
| --- | --- |
| LCP | 页面主要内容何时显示出来 |
| INP | 用户交互后多久有响应 |
| CLS | 页面布局是否跳动 |
| 首字时间 | 从发送到第一个有效输出的时间 |
| 总耗时 | 从发送到生成完成的时间 |

- AI 侧要记录发送、首个有效输出和完成三个时间点，再把工具执行、审批等待和模型生成分开统计，否则等审批的时间会被误算成模型慢。
- 按设备、模型、版本分组看分位数和失败率，不能只报平均值，平均值会掩盖少数很慢的情况。

**示例**：下面分别记录首字时间和总耗时（计时示意）。

```ts
const sentAt = performance.now(); // 发送时刻
onFirstChunk(() => record('firstChunkMs', performance.now() - sentAt)); // 首字时间
onDone(() => record('totalMs', performance.now() - sentAt));            // 总耗时
```

**Moose 里的做法**：Moose 做过特定场景下的启动、包体与内存测量，但还没有完整的线上 Core Web Vitals 和模型耗时监控面板。

## 8. 设计一个 AI 前端日志系统，结构化记录用户操作、AI 请求、响应时间、错误信息，便于回溯分析。

> **这题在考什么**：用户反馈“任务卡住了”时，只看一条错误信息通常不够。面试官想看你能否设计出能把一次请求从入队到失败串起来的日志，同时注意隐私。

**一句话回答**：用 `requestId`、`runId` 把一次执行的各个环节串起来，每条日志记录时间、事件、耗时和错误码；普通日志只留摘要，敏感内容不上传。

**展开说明**
- 结构化日志就是每条日志都用固定字段记录，而不是一句自由文本，方便按字段搜索和统计。
- 用 `requestId`、`runId` 把“入队、开始、工具调用、审批、完成”串成一条时间线。
- 每条日志记录时间、事件名、耗时和错误码。
- 普通日志只保留必要摘要；调试日志按需开启，并限制大小。不要把用户输入、密钥或完整回答直接上传。

**示例**：下面这条日志只保留排查所需的字段（示意）。

```ts
log({ event: 'run.failed', runId, requestId, // 用 ID 关联同一次执行
  durationMs, errorCode, version });         // 耗时、错误码、版本
```

**Moose 里的做法**：Moose 把用户消息、工具、审批和错误按 `runId` 保存到 SQLite，并在时间线上按顺序展示。这能追查一次任务，但没有覆盖所有用户点击的遥测平台。

## 9. 用 Vite 做构建优化：代码分割、Tree Shaking、预加载和长期缓存怎么做？还需要会 Webpack 吗？

> **这题在考什么**：新项目基本都用 Vite 起步，但老项目里还有大量 Webpack。构建慢影响开发和发布，页面加载慢影响用户，这两件事要分别衡量。拆包、预加载和缓存也都有代价，比如提前加载太多内容，首屏反而更慢。面试官想看你是否先测量、再有针对性地优化，并知道这些概念在两种工具里各叫什么。

**一句话回答**：先用打包分析看清首屏加载了什么，再用动态 `import` 把不急需的模块拆出去、保证代码能被 Tree Shaking、只预加载马上要用的内容，靠带内容哈希的文件名做长期缓存；Vite 是新项目的默认选择，Webpack 主要还在维护老项目，概念相通，会读它的配置就够了。

**展开说明**
- Vite 开发时按需编译源码、预构建依赖，所以启动快；生产构建传统上交给 Rollup，现在正在转向用 Rust 写的 Rolldown。具体用的是哪个，要看项目锁定的 Vite 版本。
- 先测量：用打包分析工具（比如 `rollup-plugin-visualizer`）看每个 chunk 里装了什么，记录首屏实际下载的 JS 体积。
- 代码分割：用动态 `import` 把非首屏的面板、对话框、大型依赖（编辑器、终端、图表）拆成单独的 chunk，用户打开时才加载。确实需要手动分组时再配置分包规则，不要一开始就把每个依赖都拆开。
- Tree Shaking（构建时删掉没被用到的代码）要求模块能被静态分析：使用 ES Module 的 `import`/`export`，避免整包导入，有副作用的模块要在 `sideEffects` 里标明。
- 预加载：Vite 会自动为入口及其直接依赖生成 `modulepreload`。手动预加载只给马上要用的内容，比如鼠标悬停在按钮上时提前 `import()`，加载过多会抢占首屏带宽。
- 长期缓存：生产产物的文件名带内容哈希，内容不变哈希就不变，可以设很长的缓存时间；HTML 入口本身不要长期缓存。开发时的依赖缓存、浏览器的资源缓存、构建工具的缓存是三回事，要分别处理。

| 概念 | Vite | Webpack |
| --- | --- | --- |
| 按需拆包 | 动态 `import()` | 动态 `import()`，`splitChunks` 控制分组 |
| 预加载 | 自动生成 `modulepreload` | `/* webpackPrefetch: true */` 等魔法注释 |
| 文件名哈希 | 默认带哈希 | `[contenthash]` |
| 构建缓存 | 依赖预构建缓存 | `cache: { type: 'filesystem' }` |

**示例**：下面让非首屏面板在用户打开时才加载，并在悬停时提前下载（React 示意）。

```tsx
const loadReview = () => import('./review-panel');
const ReviewPanel = lazy(loadReview);           // 单独打包，按需加载
<button onMouseEnter={loadReview}>审查</button>  // 悬停时提前下载，点击时更快
// 打开面板时在 Suspense 内渲染 ReviewPanel
```

**Moose 里的做法**：Moose 用 Vite 构建，`package.json` 锁定的是 Vite 8.3.1，依赖里是 Rolldown、没有 Rollup。0.23.2 起服务入口（runtime 与 web-server）共用 `dist-electron/chunks/`，桌面包不再打两份后台；preload 等其余入口仍关闭代码分割。前端没有手动分包表，主要靠动态 `import`：`src/main.tsx` 先渲染启动提示，再按宿主动态加载桌面工作区或 Web 入口；`src/app.tsx` 把时间线、文件面板、审查面板、设置和搜索改为 `lazy`，终端在打开时才导入 xterm。根据 [0.23.0 验证记录](../../releases/0.23.0-validation.md)，静态入口 JS 从 730,167 B 降到 223,759 B，减少 69.4%，但工作区仍在认证后加载，同一次记录里就绪时间变化并不大。

**容易答错的地方**
- 包体变小不能自动证明启动更快，要用相同条件下打包出的应用实际测量。
- 把所有东西都设成预加载，等于没有拆包。
- 以为 Vite 开发和生产是同一套流程。开发时源码按需编译、不整体打包，生产才真正打包，所以开发环境快不代表线上首屏小。

## 10. 请设计一个 AI 前端依赖管理策略，定期更新模型 SDK、工具库，并评估兼容性与性能影响。

> **这题在考什么**：升级模型 SDK 可能改变流事件、工具调用参数或错误格式。项目照样能编译，真实运行时却可能出错。面试官想看你是否知道依赖升级要验证行为，而不只是改版本号。

**一句话回答**：锁定版本、小批量更新，先读变更说明，再跑类型、协议测试、关键 E2E 和打包验证，模型 SDK 重点查流事件、工具参数、取消和错误格式。

**展开说明**
- 锁定版本并提交锁文件，保证每个人、每次构建装的依赖都一样。
- 小批量更新，出问题时容易定位是哪个依赖导致的。
- 升级前先看变更说明，升级后跑类型检查、协议测试、关键 E2E 与打包验证。
- 模型 SDK 尤其要检查流事件、工具参数、取消和错误格式有没有变化。
- 原生依赖（包含编译好的二进制模块）还要核对运行时 ABI（二进制接口版本），否则可能在 Electron 或 Node 里加载失败。

**Moose 里的做法**：Moose 锁定 pnpm 依赖版本。Codex 协议类型可以用 `pnpm protocol:generate` 重新生成，之后还要跑类型检查、测试和真实 CLI 流程。

**容易答错的地方**
- 不能只看协议类型生成成功就认为升级没问题。

---

上一章：[六、AI 特性与前端工程实践](06-ai-features.md) ｜ [答案目录](README.md) ｜ 下一章：[八、大模型前端集成](08-llm-integration.md)
