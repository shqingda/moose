# 七、拦住坏代码 · 上：规范、流水线、依赖

> 对应答案：[07-engineering-toolchain.md](../07-engineering-toolchain.md) 第 2、4、10 题。下篇讲监控、日志和 Vite。

人会忘跑检查，工具也会换代。写的时候要尽快知道错了，所以本地只检查这次改动，反馈要快。合并或发布之前必须拦住，同一组检查不能被人用参数跳过。

模型 SDK 再加一层：编译能过，不代表流事件、取消和错误格式还跟以前一样。

## 三类检查，不要互相顶替

类型检查管类型是否对得上，常见是 `tsc --noEmit`。Lint 管潜在错误和不良写法，常见是 ESLint、oxlint、Biome。格式管空格、换行、引号，常见是 Prettier、oxfmt、Biome。

需要类型信息的检查，以 TypeScript 编译器为准。oxlint 或 Biome 再快，也不做完整的类型检查。换成它们之后，`tsc --noEmit` 仍然要跑。

ESLint 9 默认用 flat config：一个 `eslint.config.js` 导出配置数组，不再用以前 `.eslintrc` 那种层层继承。新项目按这种格式写。

```js
// eslint.config.js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/**', 'src/generated/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
];
```

oxlint、oxfmt（Oxc）和 Biome 用 Rust 写，大仓库里往往比 ESLint、Prettier 快。代价是规则和插件没有 ESLint 全。迁移前要核对团队真的依赖的规则有没有对应实现，而不是只比速度。

生成的代码和构建产物排除在检查之外，否则每轮都在报机器写出来的风格问题。lint 和格式化如果都管引号，先关掉 lint 里那些纯格式规则，让格式化工具独占风格。

Git Hook 在 `git commit` 时自动跑命令。husky、lefthook 负责装这个钩子。lint-staged 让它只检查暂存的文件。全仓库每次提交都查一遍，会慢到大家去找开关。

开关是存在的：`git commit --no-verify` 跳过 Hook。所以 Hook 只适合提前告诉你。真正的门槛是 CI 上同一组检查，没过不能合并。

提交说明要不要符合某种格式（Commitlint），看团队要不要从说明里生成变更日志。它不替代类型和测试。

## CI/CD：拦住问题，并说清产物来自哪一次提交

CI/CD 是从提交到可安装版本的一串自动检查和构建。价值不在工具名单，而在两句：有问题的代码在发布前被拦住，而且你能指出这个安装包对应哪一次提交。

PR 阶段先锁定依赖，用同一份锁文件。然后跑类型检查、lint、单元测试、构建，以及关键路径的 E2E。E2E 是模拟用户操作的端到端测试。

发布阶段只用已经通过上述验证的提交和制品。制品就是安装包这类文件。记录版本、签名和回滚方式。回滚方式要事先能说出来：坏了装回哪一个包，数据能不能被旧版本读。

调用真实模型的测试单独、受控地跑。每个 PR 都打真模型，会被登录态、额度和网络波动带着失败。失败了也不知道是代码坏了还是额度没了。

「脚本存在」不等于「每次 push 都会自动上线」。显式运行的发布流程，只有有人，或有一个你确认过的发布任务执行时才会走。两端如果分属不同系统，例如一边是 GitHub Release、一边是另一处托管，它们通常不是同一个原子事务：一端成功、另一端失败是可能的。讲流水线时要把这个窗口说出来。

## 依赖要锁住，升级要验证行为

锁文件提交进仓库，保证每台机器、每次构建装到的是同一组版本。一次升一大批，出了问题不知道是哪一个包。小批量更新，才好定位。

升级时先读变更说明，再改版本、更新锁文件，然后跑类型检查、协议测试、关键 E2E，再打包。必要时看体积和启动。

模型 SDK 重点看四样有没有变：流事件、工具参数、取消、错误格式。类型生成成功，只说明类型文件写出来了，不说明运行时的 CLI 还按旧协议说话。

原生依赖带编译好的二进制模块。除了版本号，还要核对 ABI 和运行时是不是匹配，否则可能在 Electron 或 Node 里加载失败。

**补充知识：** ABI 可以理解成「编译好的二进制期待宿主提供哪一套接口」。Node 或 Electron 的 ABI 一变，旧的 `.node` 文件会加载失败。这和 TypeScript 类型对不对是两条线。

## 容易答错的地方

Lint 找写法和一部分错误。完整的类型匹配仍靠编译器。

Hook 可以被跳过。CI 是合并前的硬门槛。

有发布脚本，只说明步骤可以跑。每次 push 都发布，是触发器已经接上。两件不是一回事。

协议类型生成成功，后面还要类型检查、测试和真实流程。生成完不算升级验证完成。

## Moose 里实际是这样

以下只对得上 [答案](../07-engineering-toolchain.md) 第 2、4、10 题。

- 没有用 ESLint 和 Prettier，用的是 oxlint 和 oxfmt。`pnpm lint` 是 `oxlint .`，`pnpm format:check` 是 `oxfmt --check .`，`pnpm typecheck` 是 `tsc --noEmit`。`pnpm build` 会先 `tsc --noEmit` 再 `vite build`。
- `.oxlintrc.json` 启用 typescript、unicorn、oxc 插件，correctness 类规则设为错误，忽略 `electron/providers/generated/**`。`.oxfmtrc.json` 规定行宽 100、单引号、保留分号和尾随逗号。
- 没有 husky、lefthook、lint-staged、Commitlint，也没有 `.github/workflows`。这些检查平时靠手动运行。
- 发布时 `pnpm release:prepare`（`scripts/release.mjs`）依次执行 `format:check`、`lint`、`test`、`build` 和 E2E，任何一步失败就不打包。
- `release:prepare` 检查并打包桌面与 Web，记录当前提交。`release:publish` 核对版本、提交和校验值，上传草稿、部署 Web，再从公网安装验证，通过后才公开 Release。
- 这是显式运行的发布流程，不能仅凭脚本存在就说每次 push 都会自动上线。两端发布不是跨 GitHub 与 Cloudflare 的原子事务，可能一端成功、另一端失败。
- 依赖版本由 pnpm 锁定。Codex 协议类型可以用 `pnpm protocol:generate` 重新生成，之后还要跑类型检查、测试和真实 CLI 流程。不能只看生成成功。

面试时不要把题目里的 ESLint、Prettier、Commitlint、Git Hook 说成 Moose 已经在用。

## 上篇先记住

类型、lint、格式是三道不同的检查。快的 Rust 工具替代不了 `tsc`。Hook 只查暂存文件，用来早点反馈。跳得过的钩子不能当发布门槛。

流水线要锁定依赖，跑完检查和关键 E2E。发布时只用验证过的提交，并说得清版本和回滚。真模型测试单独跑。升级 SDK 要读变更、小步走、重跑协议和真实流程。

Moose 用 oxlint、oxfmt 和 `tsc`，没有 Git Hook 和 GitHub Actions。发布靠手动执行的 prepare 和 publish。桌面和 Web 不是一次原子发布。
