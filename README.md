# Moose

面向 Apple Silicon Mac 的本地 Coding Agent 客户端，支持 **Codex、Grok Build 和 Pi**。

Moose 提供项目、会话、流式输出、工具记录、审批和 Git 审阅。模型推理、工具执行与登录由本机安装的官方 CLI 负责；Moose 不保存账号凭据，不提供云端业务后端。

[下载最新版本](https://github.com/shqingda/moose/releases/latest) · [文档目录](docs/README.md) · [使用指南](docs/usage.md) · [技术架构](docs/architecture.md)

## 本地开发

环境：macOS Apple Silicon、Node.js 26.8.2、pnpm 12.4.1、Xcode Command Line Tools。

```sh
pnpm install
pnpm dev
```

技术栈：Electron、TypeScript、React、Vite 8、vite-plugin-electron、shadcn / Base UI、Tailwind、Drizzle / SQLite。

## 从哪里读

- **使用应用**：[安装、代理连接与快捷键](docs/usage.md)
- **读源码**：[架构与调用链](docs/architecture.md) → [开发与打包](docs/development.md)
- **了解 Pi**：[接入方式与能力边界](docs/providers/pi.md)
- **核对质量**：[测试与验证范围](docs/testing.md) → [发布记录](docs/README.md#发布记录)
- **准备面试**：[项目经历](docs/interview/project-experience.md) → [题目](docs/interview/questions.md) / [答案](docs/interview/answers.md)

安装包使用 ad-hoc 签名并验证完整性，尚未进行 Apple 公证。首次下载可能需要在“系统设置 → 隐私与安全性”中允许打开，详见使用指南。
