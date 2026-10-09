# Moose

<img src="src/assets/moose-icon-black.png" width="96" height="96" alt="Moose 黑底拟物图标" />

Moose 是一个可扩展的 AI 编程代理工作台，提供 macOS 桌面端和本机 Web 入口。用户打开代码项目、提出开发任务，在同一个界面查看代理输出、处理审批、使用终端，并审阅和提交代码改动。

Moose 负责界面、把各家 CLI 接进同一套流程、安排任务先后，以及把会话存在本机。模型推理和代理自己调用工具，由你安装的编程代理 CLI 完成。桌面和浏览器可以连同一个本机后台，共用项目、会话和终端。没有托管云端，也没有多人共用的工作区。

[下载最新版本](https://github.com/shqingda/moose/releases/latest) · [使用指南](docs/usage.md) · [文档目录](docs/README.md)

当前源码版本为 **0.23.1**：修好终端乱码和复制权限，减少跟当前会话无关的界面刷新，流式输出时代码块的换行和复制状态会留着，文件树和搜索可以用键盘操作。见[本版说明](docs/releases/0.23.1.md)与[发布验收](docs/releases/0.23.1-validation.md)。桌面和独立 Web 按同一版本一起发布。

## 开始使用

1. 从 [GitHub Releases](https://github.com/shqingda/moose/releases/latest) 下载 Apple Silicon DMG，把 Moose.app 放进 Applications。
2. 安装包是 ad-hoc 签名，还没有 Apple 公证。第一次打开若被系统拦住，按[安装说明](docs/usage.md#安装与连接)允许打开。
3. 在终端里安装并登录要用的代理 CLI，再打开 Moose，到设置里看连接状态。各家支持到哪一步，见[代理能力表](docs/providers/native-capabilities.md)。

装好之后，普通退出（⌘Q）只关掉窗口，本机后台和正在跑的任务还在。要用浏览器打开同一份会话，或等任务结束后停掉后台，见 [Web 使用说明](docs/web.md#桌面安装版在浏览器中打开同一工作区)。

## 命令行安装 Web 版

macOS Apple Silicon 可以直接安装，无需预装 Node.js 或 pnpm：

```sh
curl -fsSL https://moose.shqingda.workers.dev/install.sh | sh
```

安装后打开新的终端，输入 `moose` 即可启动服务并打开浏览器。`moose status` 查看状态，`moose stop` 停止服务及任务；`moose update` 下载并校验新版，等任务结束后重启后台才换成新版。代理 CLI 仍要单独安装和登录。安装包怎么构建、发布失败怎么核对，见 [Web 分发说明](distribution/README.md)。

从 0.21.0 或更早的独立 Web 升级时，要先再跑一次上面的安装命令，之后才能用 `moose update`。见 [Web 更新](docs/web.md#更新独立-web-版)。

## 本地开发

当前验证环境为 macOS Apple Silicon、Node.js 26 和 pnpm 12.6.0；构建原生依赖需要 Xcode Command Line Tools。精确依赖版本由 [package.json](package.json) 和锁文件管理。

```sh
pnpm install
pnpm dev
```

浏览器开发入口使用 `pnpm web:build`。若报 `node: not found`，先核对 PATH，见[开发与打包](docs/development.md#环境与常用命令)。

技术栈：Electron、React、TypeScript、Vite、shadcn / Base UI、Tailwind CSS、SQLite / Drizzle。

## 阅读入口

| 目的                           | 文档                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| 安装、更新、连接代理、日常操作 | [使用指南](docs/usage.md)                                                                    |
| 在浏览器中使用同一工作区       | [Web 使用说明](docs/web.md)                                                                  |
| 理解分层与执行链路             | [技术架构](docs/architecture.md)                                                             |
| 开发、测试与发布               | [开发与打包](docs/development.md) · [测试与验证](docs/testing.md)                            |
| 修改应用图标与 Web favicon     | [图标与品牌资源](docs/development.md#图标与品牌资源)                                         |
| 准备项目面试                   | [面试材料入口](docs/interview/README.md)                                                     |
| 查看剩余工作和版本记录         | [开发计划](docs/providers/native-capabilities-plan.md) · [发布记录](docs/README.md#历史记录) |
