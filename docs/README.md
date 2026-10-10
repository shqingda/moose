# 文档入口

当前说明以 **0.23.3** 源码为基线。日常使用、实现原理和面试材料分别维护；历史发布记录只说明当时交付了什么。

## 当前版本

源码版本是 **0.23.3**。这一版记住上次的底座与模式选择，四个底座统一计划／目标与三档权限，并处理好会员过期和 CLI 卡住。做了什么、怎么验收，见[本版说明](releases/0.23.3.md)和[发布验收](releases/0.23.3-validation.md)。正式下载以 GitHub Releases 和公网安装器为准。文档里的版本号跟 `package.json` 走；只改文档不会替换已经发布的安装包和 Git tag。

桌面用户从应用菜单检查更新并下载替换；独立 Web 用户执行 `moose update`，任务结束后重启后台。步骤分别见[桌面更新](usage.md#更新桌面版)和[Web 更新](web.md#更新独立-web-版)。

## 按任务查阅

| 你想了解什么 | 从这里开始 |
| --- | --- |
| 安装、更新、登录、会话、终端与 Git 操作 | [使用指南](usage.md) |
| 浏览器入口、共享后台、目录选择与连接问题 | [Web 使用说明](web.md) |
| 进程分工、消息执行与数据存储 | [技术架构](architecture.md) |
| 本地开发、构建与发布 | [开发与打包](development.md) |
| 应用图标和 Web favicon | [图标与品牌资源](development.md#图标与品牌资源) |
| 当前版本怎么验收、发布时过了哪些检查 | [0.23.3 发布验收](releases/0.23.3-validation.md) |
| 选择测试、后台验收与验证边界 | [测试与验证](testing.md) |
| 各代理已经接入哪些能力 | [底座能力与接入边界](providers/native-capabilities.md) |
| 已完成的阶段和后续范围 | [开发计划](providers/native-capabilities-plan.md) |
| 项目介绍、简历写法与技术追问 | [面试材料入口](interview/README.md) |

## 专题与练习

- [Pi 接入细节](providers/pi.md)：按行 JSON 协议、一轮何时算结束、权限到哪一步。
- [面试题目](interview/questions.md)与[参考答案](interview/answers/README.md)：常见前端和 AI 应用题，按原题号对应。这些题不能用来证明 Moose 已经做了题里的方案。
- [React 搜索代码审查练习](interview/react-search-results-code-review.md)。
- [Agent 与 Skill 追问备忘](interview/agent-skill-interview-retrospective.md)：相关岗位按需阅读，不作为 Moose 的实现说明。

面试材料怎么读、先看哪一篇，以[面试入口](interview/README.md)为准。

## 历史记录

下面是当时的交付说明和测量，不是当前操作步骤。阅读时以每篇自己写的版本和日期为准。各版发布说明都在 [releases 目录](releases/)。

| 记录 | 内容 |
| --- | --- |
| [0.23.2](releases/0.23.2.md)、[0.23.1](releases/0.23.1.md)、[0.23.0](releases/0.23.0.md) | 启动与资源、终端阅读、加载和传输。0.23.0 的测量在[性能验收](releases/0.23.0-validation.md) |
| [0.22.1](releases/0.22.1.md)、[0.22.0](releases/0.22.0.md) | 界面重构那一轮。体积和功能对照在[验收记录](releases/0.22.0-validation.md)，原始证据在[证据索引](releases/0.22.0-evidence.md)；没做完的人工项仍在 [TODO](TODO-0.22.0.md) |
| [阶段验收归档](releases/feature-validation-history.md) | 0.8–0.13 的操作和证据，界面名称可能已变 |
| [专项验证记录](releases/runtime-validation-history.md) | 共享后台、长历史、配置和搜索的原始测量 |
| [早期验证记录](releases/validation-history.md) | 2026-09-13 的验收。其中“不导入 CLI 历史”“退出后任务不继续”只对当时的版本成立 |

## 维护约定

使用步骤写入使用指南；源码职责写入架构；开发命令写入开发指南；验证方法写入测试指南，历史测量与专项验收结果写入对应归档。能力支持范围集中在能力表，待办集中在开发计划，面试材料引用这些事实并解释取舍。

更新功能时同步修改对应主文档，不追加另一份内容相同的阶段说明。发布记录保留版本、验证条件和限制；协议夹具通过、真实 CLI 握手通过、真实模型任务通过必须分别说明。

文档版本由 `package.json` 对照更新；发布后的文档修订不改变已发布安装包和 Git tag。核查方法见[文档修改](testing.md#文档修改)。
