# Moose

Moose 是一个可扩展的 AI 编程代理工作台，提供 macOS 桌面端和本机 Web 入口。用户打开代码项目、提出开发任务，在同一个界面查看代理输出、处理审批、使用终端，并审阅和提交代码改动。

Moose 负责交互、协议适配、任务调度和历史存储；模型推理与代理内部的工具执行由本机安装的编程代理 CLI 负责。桌面和浏览器可以连接同一个本机后台，共用项目、会话和终端。当前不提供托管云端或多人工作区。

[下载最新版本](https://github.com/shqingda/moose/releases/latest) · [使用指南](docs/usage.md) · [文档目录](docs/README.md)

## 开始使用

下载 Apple Silicon DMG，将 Moose.app 放入 Applications。先在终端安装并登录需要的代理，再打开 Moose，在设置中检查连接状态。支持范围见[代理能力表](docs/providers/native-capabilities.md)。

安装版普通退出会保留后台任务；需要结束任务时，使用 **Moose → 退出并停止后台**。同一菜单中的 **在浏览器中打开** 可访问当前工作区，详见 [Web 使用说明](docs/web.md)。

安装包采用 ad-hoc 签名，尚未进行 Apple 公证；首次打开方式见[安装说明](docs/usage.md#安装与连接)。

## 命令行安装 Web 版

macOS Apple Silicon 可以直接安装，无需预装 Node.js 或 pnpm：

```sh
curl -fsSL https://moose.shqingda.workers.dev/install.sh | sh
```

安装后打开新的终端，输入 `moose` 即可启动服务并打开浏览器。`moose status` 查看状态，
`moose stop` 停止服务及任务。代理 CLI 仍需单独安装和登录。
安装与发布细节见 [Web 分发说明](distribution/README.md)。

## 本地开发

当前验证环境为 macOS Apple Silicon、Node.js 26 和 pnpm 12.5.1；构建原生依赖需要 Xcode Command Line Tools。精确依赖版本由 [package.json](package.json) 和锁文件管理。

```sh
pnpm install
pnpm dev
```

浏览器开发入口使用 `pnpm web:build`。若报 `node: not found`，先核对 PATH，见[开发与打包](docs/development.md#环境与常用命令)。

技术栈：Electron、React、TypeScript、Vite、shadcn / Base UI、Tailwind CSS、SQLite / Drizzle。

## 阅读入口

| 目的                     | 文档                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| 安装、连接代理、日常操作 | [使用指南](docs/usage.md)                                                                    |
| 在浏览器中使用同一工作区 | [Web 使用说明](docs/web.md)                                                                  |
| 理解分层与执行链路       | [技术架构](docs/architecture.md)                                                             |
| 开发、测试与发布         | [开发与打包](docs/development.md) · [测试与验证](docs/testing.md)                            |
| 准备项目面试             | [项目面试指南](docs/interview/project-interview-guide.md)                                    |
| 查看剩余工作和版本记录   | [开发计划](docs/providers/native-capabilities-plan.md) · [发布记录](docs/README.md#历史记录) |
