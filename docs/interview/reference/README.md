# Moose 项目面试追问资料

本文配合[简明指南](../project-interview-guide.md)使用：指南讲主线，这里按话题收集实现细节、设计理由、失败处理和验证证据。被追问到某一点时再来查，不必通读。

| 阅读前须知 | 说明 |
| --- | --- |
| 源码基准 | **Moose 0.23.1**，核对日期 2026-10-09。计划、目标与权限三档的当前范围见[专文](08-plan-goal-permissions.md)（0.23.3） |
| 性能与验收数字 | 都注明了当时的版本和条件，不代表当前版本重新测过 |
| 底座是否支持某项功能 | 以[能力表](../../providers/native-capabilities.md)为准 |
| 引用块里的第一人称回答 | 只是示范，请按自己实际参与的部分改写 |

## 怎么用这份资料

**一句话**：按岗位挑章节读，先分清“底座”和“后台”这两个词。

| 你想弄清的问题 | 建议阅读顺序 |
| --- | --- |
| 项目里有哪些对象、谁调用谁 | 第 2 节（职责与术语）→ 第 3 节（进程）→ 第 4 节（任务链路） |
| 前端岗位：流式更新、异步竞争、交互细节 | 第 6 节 → 第 19 节 → 第 14 节 |
| 后端／系统岗位：排队、并发、重启恢复 | 第 7 节 → 第 13 节 → 第 16 节 |
| Agent／协议岗位 | 第 5、8、9、12 节，再读[计划、目标与三档权限](08-plan-goal-permissions.md) |
| 准备演示、简历或回答性能问题 | 第 15 节（验证）→ 第 17 节（取舍）→ 第 18 节（简历与演示） |

全文先分清两个词，它们不是同一个进程：

| 词 | 指什么 |
| --- | --- |
| **底座** | 接入的代理 CLI（Codex、Grok Build、Pi、OpenCode） |
| **后台** | Moose 自己的本机服务进程 |

## 目录

### [项目全貌：职责、进程与任务链路](01-project-overview.md)

- [1. 先把项目讲清楚](01-project-overview.md#1-先把项目讲清楚)
- [2. 哪些是自己做的，哪些来自底座](01-project-overview.md#2-哪些是自己做的哪些来自底座)
- [3. 为什么分成三类进程](01-project-overview.md#3-为什么分成三类进程)
- [4. 从按下发送到任务结束](01-project-overview.md#4-从按下发送到任务结束)

### [代理接入与流式消息](02-agents-and-streaming.md)

- [5. 不同代理如何接进同一套界面](02-agents-and-streaming.md#5-不同代理如何接进同一套界面)
- [6. 流式消息和 React 页面如何保持一致](02-agents-and-streaming.md#6-流式消息和-react-页面如何保持一致)

### [任务执行：排队恢复、Plan／Goal 与历史](03-execution.md)

- [7. 排队、并行和重启恢复](03-execution.md#7-排队并行和重启恢复)
- [8. Plan、Goal 和运行中插话](03-execution.md#8-plangoal-和运行中插话)
- [9. 原生历史与子代理](03-execution.md#9-原生历史与子代理)

### [计划、目标与三档权限](08-plan-goal-permissions.md)

- [30 秒怎么答](08-plan-goal-permissions.md#30-秒怎么答)
- [先把两个开关分开](08-plan-goal-permissions.md#1-先把两个开关分开)
- [Plan 和 Goal 是宿主概念](08-plan-goal-permissions.md#2-plan-和-goal-是宿主概念)
- [Moose 怎样驱动 Codex 的目标](08-plan-goal-permissions.md#3-moose-怎样驱动-codex-的目标)
- [0.23.3 四家分别怎么接](08-plan-goal-permissions.md#4-0233-四家分别怎么接)
- [和主流产品的权限怎么对上](08-plan-goal-permissions.md#5-和主流产品的权限怎么对上)

### [Git、扩展配置与后台任务](04-git-extensions-background.md)

- [10. 用 worktree 隔离代码修改](04-git-extensions-background.md#10-用-worktree-隔离代码修改)
- [11. Git 提交、PR 和原生代码审查](04-git-extensions-background.md#11-git-提交pr-和原生代码审查)
- [12. 配置、MCP、插件与认证](04-git-extensions-background.md#12-配置mcp插件与认证)
- [13. 后台命令与定时任务](04-git-extensions-background.md#13-后台命令与定时任务)

### [安全边界与功能验证](05-security-and-verification.md)

- [14. 输入体验和安全边界](05-security-and-verification.md#14-输入体验和安全边界)
- [15. 怎么证明这些功能真的可用](05-security-and-verification.md#15-怎么证明这些功能真的可用)

### [面试表达：案例、取舍、简历与演示](06-interview-expression.md)

- [16. 面试里值得展开的四个问题](06-interview-expression.md#16-面试里值得展开的四个问题)
- [17. 容易被追问的技术取舍](06-interview-expression.md#17-容易被追问的技术取舍)
- [18. 简历写法、演示和最后复习](06-interview-expression.md#18-简历写法演示和最后复习)

### [搜索、通知与文件预览](07-search-notice-preview.md)

- [19. 搜索、通知和文件预览怎样串起用户体验](07-search-notice-preview.md#19-搜索通知和文件预览怎样串起用户体验)
