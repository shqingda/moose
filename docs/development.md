# 开发与打包

先读 [技术架构](architecture.md) 了解进程和数据流。环境版本和安装入口见 [README](../README.md)。

| 你要做的事 | 看哪一节 |
| --- | --- |
| 在本机跑起来、跑检查 | [环境与常用命令](#环境与常用命令) |
| 弄清五个构建入口和原生模块 | [构建与原生依赖](#构建与原生依赖) |
| 改应用图标或网页图标 | [图标与品牌资源](#图标与品牌资源) |
| 发桌面和 Web | [发布流程](#发布流程)。只构建一端不算发布完成 |
| 看包有多大 | [资源与包体积](#资源与包体积) |

## 环境与常用命令

使用 Node.js 26 和 pnpm 12.6.0；包管理器版本由 `package.json` 的 `packageManager` 固定，依赖解析以 `pnpm-lock.yaml` 为准。升级依赖时一并更新锁文件，复现既有依赖使用 `pnpm install --frozen-lockfile`。独立 Web 安装包自带的 Node.js 版本由分发脚本固定，与本地开发运行时分别管理。

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
pnpm icon:build # 图标母图修改后重新生成 macOS 图标与 Web favicon
pnpm dist      # 仅构建桌面 DMG；不等于正式联合发布
pnpm site:build # 构建官网并同步到分发目录，不部署
pnpm perf:measure # 测量已打包应用，使用隔离数据
pnpm perf:web     # 测量无浏览器 HTTP 缓存时的 Web 资源传输与就绪时间
```

Oxfmt 负责格式，Oxlint 负责基础正确性检查，不依赖 ESLint。统一 2 空格、单引号、分号及 100 列换行；生成代码、锁文件和文档由格式配置排除。没有启用完整 React Hooks / React Compiler 规则。测试命令及实际结果见 [测试与验证](testing.md)。

## 构建与原生依赖

`vite-plugin-electron` Flat API 管理 main、preload、runtime、pty-host、web-server 五个入口。全部首次构建完成后启动 Electron；preload 修改重载窗口，其他后台入口修改重启应用，React 使用 HMR。沙箱 preload 输出单文件 CJS，其余入口输出 ESM。

macOS 构建额外使用 Xcode Command Line Tools 编译 `native/notification-permission.mm`，通过 Node-API 在应用自身进程内读取／请求系统通知权限；产物 `dist-native/notifications.node` 随桌面包签名并从 ASAR 解包，独立 Web 包不需要它。构建会优先使用 Electron 重建缓存中的 Node-API 头文件，缺少时先执行 `pnpm native:rebuild`。

better-sqlite3 和 node-pty 是运行时原生依赖；安装与打包会准备原生模块，打包按 Electron arm64 ABI 重建，并将 `.node` 从 ASAR 解包。手动修复使用 `pnpm native:rebuild`。数据库与代理处理在独立后台：安装版使用共享本机服务，开发默认使用 utility process；renderer 无 Node 权限。

`MOOSE_DATA_DIR` 可指定隔离数据目录，测试不应使用正式用户数据库。Codex 协议类型基于 0.155.0（包含 `--experimental` 字段），`pnpm protocol:generate` 用当前系统 CLI 重新生成，更新后需检查兼容性。

发行包仅保留当前 macOS 架构所需的原生依赖；排除其他平台预编译文件、依赖源码与生产 source map。开发构建保留 source map。Electron 系统界面资源仅保留英语、简体中文及对应变体，与当前产品语言范围一致；其他系统语言回退英语。Unicode 数据与字体支持不裁剪。调整排除规则后必须运行安装包验收，尤其检查 SQLite 和 PTY，不以构建成功代替运行验证。

## 图标与品牌资源

当前 macOS 应用与 Dock 使用从 0.21.3 起采用的白底拟物版；0.21.2 安装包使用黑底版，官网仍沿用黑底标识。各用途分别维护，不要把侧边栏剪影替换成大尺寸应用图标：

| 用途 | 源资源与使用位置 | 生成或更新方式 |
| --- | --- | --- |
| macOS 应用与 Dock | [moose-icon-white.png](../src/assets/moose-icon-white.png)；桌面打包读取 `build/icon.icns` | 修改白底母图后执行 `pnpm icon:build` |
| 官网与 README 标识 | [moose-icon-black.png](../src/assets/moose-icon-black.png) | 直接导入黑底母图 |
| 会话区欢迎 logo | [moose-logo-transparent.png](../src/assets/moose-logo-transparent.png)；[welcome.tsx](../src/components/welcome.tsx) 使用派生的 `moose-logo-welcome.png` 透明 PNG，容器无底色 | 单独维护透明素材；保留金色鹿角、象牙白鹿头、黑色实心眼睛和透明边缘 |
| 侧边栏剪影与 Web favicon | [moose-mark.json](../src/assets/moose-mark.json)；[MooseMark](../src/components/common.tsx) 使用 `currentColor`，favicon 导出为深浅两份 | 修改共享矢量轮廓后执行 `pnpm icon:build`；侧边栏外观沿用原版 |

`pnpm icon:build` 调用 [scripts/icon.swift](../scripts/icon.swift) 生成 `build/icon.iconset/` 各尺寸 PNG，以及 `public/` 和 `distribution/site/public/` 中的 `favicon.svg`、`favicon-light.svg`，再通过 `iconutil` 生成 `build/icon.icns`。生成资源随源文件一起提交；该命令不会重新生成透明 logo。欢迎页展示 96 CSS 像素，使用 288×288 的三倍尺寸派生图；更新原图后执行 `sips -Z 288 src/assets/moose-logo-transparent.png --out src/assets/moose-logo-welcome.png`。保留原始母图，检查浅深背景与边缘透明度。

应用入口 [index.html](../index.html) 与官网 [根路由](../distribution/site/src/routes/__root.tsx) 通过 `prefers-color-scheme` 选择 favicon：浅色系统用 `favicon.svg`（深色剪影），深色系统用 `favicon-light.svg`（浅色剪影）。它跟随系统偏好，不读取 Moose 的主题设置。

旧绿色拟物 PNG 保留为历史素材，不作为当前打包源。生成提示与历史来源见[图标生成记录](../src/assets/moose-icon-skeuomorphic.md)。视觉核查方法见[测试指南](testing.md#图标与主题验收)。

## 发布流程

每次必须同时发布桌面与 Web，版本号统一从 `package.json` 读取。不得只更新一端或复用旧版本号替换安装包。

1. 更新 `package.json` 版本与 `docs/releases/<version>.md`、文档索引，提交完整变更。
2. `pnpm release:prepare`：格式、Lint、单元、类型／构建及全部 E2E；构建 arm64 DMG，验证严格签名与打包应用；构建独立 Web 包，验证干净安装、localhost、SQLite、PTY、重装、更新保留运行任务、校验失败保留旧版、停止／启动与自动打开浏览器。
3. `pnpm release:publish`：要求工作区干净，准备记录对应当前提交，桌面 App、DMG、Web 清单和校验值匹配同一版本。推送代码及 tag，把两端安装包上传至 GitHub 草稿 Release，再部署 Cloudflare。
4. 脚本等待公网版本清单与本地产物一致，再从正式 Web 地址重新安装并验证；通过后才将 GitHub Release 公开并设为最新。任何一步失败均不报告发布完成；保留草稿，排查后重试，不能绕过另一端验证。

```sh
pnpm release:prepare
pnpm release:publish
```

正式发布前需能使用已登录的 `gh` 和 Cloudflare Wrangler，并能下载分发脚本固定的官方 Node.js 压缩包。`release:publish` 推送当前提交及 `v<version>` 标签，不自动切换或重写分支。

| 文件或记录 | 含义 |
| --- | --- |
| `release/Moose-<version>-arm64.dmg` | macOS 桌面安装包 |
| `release/Moose-<version>-web-darwin-arm64.tar.gz` | 独立 Web 安装包 |
| `release/Moose-<version>-SHA256SUMS.txt` | 两端安装包的 SHA-256 |
| `release/prepared.json` | 已验收的版本、Git 提交与安装包路径 |
| `distribution/public/latest-darwin-arm64.txt` | Web 发行标识、完整压缩包 SHA-256 和分片数；标识形如 `<version>-<hash前12位>`，包内版本仍取自 `package.json` |

发布入口在 `scripts/release.mjs`。两处服务无法进行跨平台原子提交，因此按上述顺序进行一次联合发布；公网验证未通过时桌面保持草稿。已发布 Web 的历史分片需要保留，避免升级时打断正在进行的下载。详情见 [Web 分发说明](../distribution/README.md)。

### 发布失败后的处理

- **准备失败**：修复格式、测试或打包问题并提交；从新的干净提交重新执行 `pnpm release:prepare`，再发布。准备记录与提交绑定，不能直接复用旧记录。
- **上传或部署失败**：保留草稿 Release、当前标签和发行文件。问题解决后，在相同版本、相同准备提交上重跑 `pnpm release:publish`；该命令可恢复草稿发布。
- **公网安装失败**：即使版本清单已经切换，也需确认所有分片可下载。部署传播期间分片可能短暂返回 404；核对[分发说明](../distribution/README.md#deployment-recovery)中的地址后重跑正式发布命令，不能手动跳过 smoke 或提前公开 Release。
- **版本已经公开**：发布脚本拒绝覆盖已公开版本。需要修改安装包时增加新版本；单纯文档修订不重新打包或改写发布标签。

当前使用 ad-hoc 签名，没有 Apple 公证、自动安装升级或遥测；Web 的 `moose update` 是用户主动执行的安装更新，保留现有后台直到用户重启。签名失败应中止发布；不要把去除下载隔离标记描述为签名或公证的替代品。

## 资源与包体积

`pnpm size:measure` 输出当前干净构建的 JSON：前端资源总字节、入口静态依赖图的原始／gzip 字节、按需 JS 以及桌面 App、DMG、Web 归档大小。可用 `node scripts/measure-size.mjs <另一构建目录>` 按同一口径比较；没有生成的安装包标为 `null`，不能当成零。入口依赖图不包含交互后加载的模块，也不是网络瀑布。

高亮使用 Pierre 1.5.1、JavaScript 正则引擎和 GitHub 浅／深两套实际主题，所有现有语言加载器仍打包。`pnpm-workspace.yaml` 注册 [Pierre 补丁](../patches/@pierre__diffs@1.5.1.patch)，锁文件记录指纹；它只收窄未使用的主题集合和 WASM 入口。依赖升级时重新审阅补丁并验证源码、Markdown 与 diff 的离线显示，不能直接丢弃补丁或删语言包来追求数字下降。

主应用、官网 `distribution/site`、周边站 `merch-store` 继续独立构建。截图、测试夹具和验收报告不进入生产包；SQLite、PTY、原生通知桥和签名检查保留。
