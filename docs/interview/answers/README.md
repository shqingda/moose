# 前端与 AI 应用面试参考答案

配合[题目](../questions.md)使用，共 71 题，按“章节＋原题号”对应；题号不连续是沿用了原题号，不是答案遗漏。

每道题都按同一个顺序排列，可以只读需要的部分：

| 小节 | 作用 |
| --- | --- |
| **这题在考什么** | 交代背景：实际开发中什么时候会碰到这个问题，面试官想看什么 |
| **一句话回答** | 可以直接对面试官说出口的结论 |
| **展开说明** | 具体做法和理由；对比内容用表格 |
| **示例** | 带中文注释的代码，只用于讲解 |
| **Moose 里的做法** | 项目的实际实现（按 0.23.1 源码核对）；与项目无关的题省略 |
| **容易答错的地方** | 常见的过度结论和边界 |

只有“Moose 里的做法”是项目的真实实现，其余代码和方案都是通用讲解。完整项目链路见[项目面试指南](../project-interview-guide.md)。

按同样题目顺序练口的题单在 [rehab/](rehab/README.md)，不替代本目录的答题稿。

## 章节目录

| 章节 | 题数 |
| --- | --- |
| [一、TypeScript 与类型系统](01-typescript.md) | 4 |
| [二、流式处理与实时通信](02-streaming.md) | 5 |
| [三、前端状态管理与数据流](03-state-management.md) | 4 |
| [四、性能优化与渲染](04-performance.md) | 3 |
| [五、前端 AI 架构设计](05-architecture.md) | 2 |
| [六、AI 特性与前端工程实践](06-ai-features.md) | 5 |
| [七、AI 工程化与前端工具链](07-engineering-toolchain.md) | 6 |
| [八、大模型前端集成](08-llm-integration.md) | 3 |
| [场景题：页面交互、浏览器 API 与 React](09-scenarios-ui-react.md) | 16 |
| [场景题：性能、监控与线上问题](10-scenarios-performance-monitoring.md) | 6 |
| [场景题：网络、请求、上传与登录](11-scenarios-network-upload.md) | 8 |
| [场景题：Git、代码质量与发布](12-scenarios-engineering.md) | 9 |

## 源码核对入口

文中的 Moose 实例按 0.23.1 源码核对，可从以下文件查起。方案题里描述的做法不代表项目已经实现。

| 文件 | 适合核对的主题 |
| --- | --- |
| [shared/types.ts](../../../shared/types.ts) | 泛型 IPC、Session/Message/Status、用量类型 |
| [shared/validation.ts](../../../shared/validation.ts) | Zod 运行时校验与输入边界 |
| [electron/service.ts](../../../electron/service.ts) | 请求分发、目录互斥、调度原因 |
| [electron/session-execution.ts](../../../electron/session-execution.ts) | 队列执行、流式事件合并、80 ms 批量落库、取消 |
| [electron/provider-registry.ts](../../../electron/provider-registry.ts) | 代理发现、额度查询的并发合并 |
| [electron/db/store.ts](../../../electron/db/store.ts) | SQLite 事务、消息版本、分页、启动恢复 |
| [electron/providers/types.ts](../../../electron/providers/types.ts) | AgentAdapter、统一事件与能力差异 |
| [electron/providers/rpc.ts](../../../electron/providers/rpc.ts) | stdio 拆包、请求 ID、超时和连接关闭 |
| [electron/runtime-host.ts](../../../electron/runtime-host.ts) | utility process 生命周期与请求关联 |
| [electron/preload.ts](../../../electron/preload.ts) | Renderer 的受限桥接接口 |
| [electron/main.ts](../../../electron/main.ts) | 窗口、IPC 来源校验与安全设置 |
| [electron/web-server.ts](../../../electron/web-server.ts) / [src/lib/web-api.ts](../../../src/lib/web-api.ts) | Web Cookie、SSE 与断线重拉 |
| [electron/attachments.ts](../../../electron/attachments.ts) / [src/components/composer.tsx](../../../src/components/composer.tsx) | 附件大小、导入与拖放 |
| [src/lib/workspace.ts](../../../src/lib/workspace.ts) | 快照、请求代次、历史分页 |
| [src/lib/transcript-messages.ts](../../../src/lib/transcript-messages.ts) | 按 `seq` 合并消息、保持引用稳定 |
| [src/components/transcript.tsx](../../../src/components/transcript.tsx) | Markdown、memo、工具折叠和完整回答复制 |
| [src/components/ui/message-scroller.tsx](../../../src/components/ui/message-scroller.tsx) | 滚动容器与 content-visibility |
| [src/lib/auxiliary-panel.tsx](../../../src/lib/auxiliary-panel.tsx) / [src/components/terminal-view.tsx](../../../src/components/terminal-view.tsx) | 面板拖动、窗口变化与 ResizeObserver |
| [src/lib/i18n.tsx](../../../src/lib/i18n.tsx) / [src/app.tsx](../../../src/app.tsx) / [src/components/search-dialog.tsx](../../../src/components/search-dialog.tsx) | 国际化、主题、搜索防抖与代次 |
| [pnpm-workspace.yaml](../../../pnpm-workspace.yaml) / [scripts/measure-performance.ts](../../../scripts/measure-performance.ts) | workspace 与性能脚本 |
| [vite.config.ts](../../../vite.config.ts) / [package.json](../../../package.json) | 构建入口、脚本、依赖和打包范围 |

搜索、通知、预览及错误契约另见 [shared/experience.ts](../../../shared/experience.ts)、[experience-data.ts](../../../electron/experience-data.ts)、[notices.ts](../../../electron/notices.ts)、[file-preview.ts](../../../electron/file-preview.ts) 和 [shared/errors.ts](../../../shared/errors.ts)。
