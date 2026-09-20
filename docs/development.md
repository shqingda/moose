# 开发与打包

先读 [技术架构](architecture.md) 了解进程和数据流。环境版本及安装入口见 [README](../README.md)。

## 环境与常用命令

使用 Node.js 26 和 pnpm 12.5.1；包管理器版本由 `package.json` 的 `packageManager` 固定，依赖解析以 `pnpm-lock.yaml` 为准。升级依赖时一并更新锁文件，CI 使用 `pnpm install --frozen-lockfile`。

如果 macOS 报 `node: not found`，先确认 Node 已安装且终端 PATH 正确。Homebrew 默认安装位置可这样加入当前终端：

```sh
export PATH="/opt/homebrew/bin:$PATH"
node --version
pnpm --version
```

以下命令在仓库根目录执行：

```sh
pnpm install
pnpm dev
pnpm web:build # 构建并启动本机浏览器入口
pnpm format
pnpm format:check
pnpm lint
pnpm lint:fix
pnpm typecheck
pnpm build
pnpm dist
pnpm perf:measure # 测量已打包应用，使用隔离数据
```

Oxfmt 负责格式，Oxlint 负责基础正确性检查，不依赖 ESLint。统一 2 空格、单引号、分号及 100 列换行；生成代码、锁文件和文档由格式配置排除。没有启用完整 React Hooks / React Compiler 规则。测试命令及实际结果见 [测试与验证](testing.md)。

## 构建与原生依赖

`vite-plugin-electron` Flat API 管理 main、preload、runtime、pty-host、web-server 五个入口。全部首次构建完成后启动 Electron；preload 修改重载窗口，其他后台入口修改重启应用，React 使用 HMR。沙箱 preload 输出单文件 CJS，其余入口输出 ESM。

better-sqlite3 和 node-pty 是运行时原生依赖；安装与打包会准备原生模块，打包按 Electron arm64 ABI 重建，并将 `.node` 从 ASAR 解包。手动修复使用 `pnpm native:rebuild`。数据库与代理处理在独立后台：安装版使用共享本机服务，开发默认使用 utility process；renderer 无 Node 权限。

`MOOSE_DATA_DIR` 可指定隔离数据目录，测试不应使用正式用户数据库。Codex 协议类型基于 0.155.0（包含 `--experimental` 字段），`pnpm protocol:generate` 用当前系统 CLI 重新生成，更新后需检查兼容性。

发行包仅保留当前 macOS 架构所需的原生依赖；排除其他平台预编译文件、依赖源码与生产 source map。开发构建保留 source map。Electron 系统界面资源仅保留英语、简体中文及对应变体，与当前产品语言范围一致；其他系统语言回退英语。Unicode 数据与字体支持不裁剪。调整排除规则后必须运行安装包验收，尤其检查 SQLite 和 PTY，不以构建成功代替运行验证。

## 发布流程

1. 更新 package.json 版本与 `docs/releases/<version>.md`。
2. 完成格式、Lint、类型、单元和 Electron 测试。
3. `pnpm dist` 构建 arm64 DMG；afterSign 钩子严格验证应用签名。
4. `pnpm exec tsx scripts/package-smoke.ts` 启动打包后的应用，检查版本、沙箱、SQLite、Shell、PTY 和调度；默认后台运行，不抢占桌面。
5. 提交、推送，创建与代码提交对应的 GitHub tag / Release，上传 DMG 和校验值。

当前使用 ad-hoc 签名，没有 Apple 公证、自动更新或遥测。签名失败应中止发布；不要把去除下载隔离标记描述为签名或公证的替代品。应用图标源在仓库中，`pnpm icon:build` 可重新生成。
