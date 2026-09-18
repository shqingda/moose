# 开发与打包

先读 [技术架构](architecture.md) 了解进程和数据流。环境版本及安装入口见 [README](../README.md)。

## 常用命令

```sh
pnpm install
pnpm dev
pnpm format
pnpm format:check
pnpm lint
pnpm lint:fix
pnpm typecheck
pnpm build
pnpm dist
```

Oxfmt 负责格式，Oxlint 负责基础正确性检查，不依赖 ESLint。统一 2 空格、单引号、分号及 100 列换行；生成代码、锁文件和文档由格式配置排除。没有启用完整 React Hooks / React Compiler 规则。测试命令及实际结果见 [测试与验证](testing.md)。

## 构建与原生依赖

`vite-plugin-electron` Flat API 管理 main、preload、runtime 三入口。三个入口首次构建后启动 Electron；main/runtime 修改重启进程，preload 修改重载窗口，React 使用 HMR。main/runtime 是 ESM，沙箱 preload 输出单文件 CJS。

better-sqlite3 是运行时依赖；安装与打包会准备原生模块，打包按 Electron arm64 ABI 重建，并将 `.node` 从 ASAR 解包。手动修复使用 `pnpm native:rebuild`。数据库与代理处理在 utility process，renderer 无 Node 权限。

`MOOSE_DATA_DIR` 可指定隔离数据目录，测试不应使用正式用户数据库。Codex 协议类型基于 0.155.0（包含 `--experimental` 字段），`pnpm protocol:generate` 用当前系统 CLI 重新生成，更新后需检查兼容性。

## 发布流程

1. 更新 package.json 版本与 `docs/releases/<version>.md`。
2. 完成格式、Lint、类型、单元和 Electron 测试。
3. `pnpm dist` 构建 arm64 DMG；afterSign 钩子严格验证应用签名。
4. `pnpm exec tsx scripts/package-smoke.ts` 启动打包后的应用，检查版本、沙箱和 SQLite。
5. 提交、推送，创建与代码提交对应的 GitHub tag / Release，上传 DMG 和校验值。

当前使用 ad-hoc 签名，没有 Apple 公证、自动更新或遥测。签名失败应中止发布；不要把去除下载隔离标记描述为签名或公证的替代品。应用图标源在仓库中，`pnpm icon:build` 可重新生成。
