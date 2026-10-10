# 七、AI 工程化与前端工具链 · 上

> 题单，对着说。每题顺序固定：这题在考什么 → 一句话回答 → 展开说明 → 示例 → Moose 里的做法 → 容易答错的地方。对应 [答案](../07-engineering-toolchain.md) 第 2、4、10 题。下篇是监控、日志和构建。事实按 Moose 0.23.3。答题稿里写了「没有」的，不要说成已经做了。

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

上一篇：[六、输出安全与审批 · 下](06-ai-features-2.md) ｜ [题单目录](README.md) ｜ 下一篇：[七、工具链 · 下](07-toolchain-2.md)
