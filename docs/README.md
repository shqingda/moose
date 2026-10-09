# 文档入口

当前说明以 **0.23.1** 源码为基线。日常使用、实现原理和面试材料分别维护；历史发布记录只说明当时交付了什么。

## 当前版本

0.23.1 修复终端乱码与复制权限错误，优化 Markdown 更新连续性、无关重绘和键盘导航。见[本版说明](releases/0.23.1.md)、[发布验收](releases/0.23.1-validation.md)。正式下载以 GitHub Releases 和公网安装器为准；验收中的源码不代表已发布。

桌面用户从应用菜单检查更新并下载替换；独立 Web 用户执行 `moose update`，任务结束后重启后台。具体步骤分别见[桌面更新](usage.md#更新桌面版)和[Web 更新](web.md#更新独立-web-版)。

## 按任务查阅

| 你想了解什么 | 从这里开始 |
| --- | --- |
| 安装、更新、登录、会话、终端与 Git 操作 | [使用指南](usage.md) |
| 浏览器入口、共享后台、目录选择与连接问题 | [Web 使用说明](web.md) |
| 进程分工、消息执行与数据存储 | [技术架构](architecture.md) |
| 本地开发、构建与发布 | [开发与打包](development.md) |
| 应用图标、透明 logo 和 Web favicon | [图标与品牌资源](development.md#图标与品牌资源) |
| 当前版本的双端准备、性能与发布验证 | [0.23.1 发布验收](releases/0.23.1-validation.md) |
| 功能保留、体积对照、本轮验收状态 | [0.22.0 验收记录](releases/0.22.0-validation.md) |
| 发布后原始证据、逐项断言、截图与人工验收步骤 | [0.22.0 证据索引](releases/0.22.0-evidence.md) |
| 选择测试、后台验收与验证边界 | [测试与验证](testing.md) |
| 各代理已经接入哪些能力 | [底座能力与接入边界](providers/native-capabilities.md) |
| 已完成的阶段和后续范围 | [开发计划](providers/native-capabilities-plan.md) |
| 项目介绍、简历写法与技术追问 | [面试材料入口](interview/README.md) |

## 专题与练习

- [Pi 接入细节](providers/pi.md)：自定义 JSONL RPC、完成信号与权限边界。
- [面试题目](interview/questions.md)与[参考答案](interview/answers/README.md)：保留常见前端与 AI 应用题，按原题号对应；不作为项目已实现能力的证明。
- [React 搜索代码审查练习](interview/react-search-results-code-review.md)。
- [Agent 与 Skill 追问备忘](interview/agent-skill-interview-retrospective.md)：相关岗位按需阅读，不作为 Moose 的实现说明。

项目介绍放在[简明指南](interview/project-interview-guide.md)，协议与调用链放在[追问资料](interview/reference/README.md)。通用题用“章节＋原题号”定位，每题链接到对应答案。

## 历史记录

- [0.23.0 发布说明](releases/0.23.0.md)与[性能验收](releases/0.23.0-validation.md)。
- [0.22.1 发布说明](releases/0.22.1.md)。
- [0.22.0 发布说明](releases/0.22.0.md)。
- [0.21.4 发布说明](releases/0.21.4.md)。
- [0.21.3 发布说明](releases/0.21.3.md)。
- [0.21.2 发布说明](releases/0.21.2.md)。
- [0.21.1 发布说明](releases/0.21.1.md)。
- [0.21.0 发布说明](releases/0.21.0.md)；其他版本见 [releases 目录](releases/)。
- [阶段验收归档](releases/feature-validation-history.md)：原六份阶段验收的操作与证据，按当时版本解释。
- [运行与界面专项验证记录](releases/runtime-validation-history.md)：共享后台、长历史、配置适配与搜索测量，保留原始日期和条件。
- [早期验证记录](releases/validation-history.md)。
- [Roost / DeepSeek Harness 调研](research/web-ui-and-roost.md)：保留调研背景和原始方案，当前实现以使用指南、架构与开发计划为准。

## 维护约定

使用步骤写入使用指南；源码职责写入架构；开发命令写入开发指南；验证方法写入测试指南，历史测量与专项验收结果写入对应归档。能力支持范围集中在能力表，待办集中在开发计划，面试材料引用这些事实并解释取舍。

更新功能时同步修改对应主文档，不追加另一份内容相同的阶段说明。发布记录保留版本、验证条件和限制；协议夹具通过、真实 CLI 握手通过、真实模型任务通过必须分别说明。

文档版本由 `package.json` 对照更新；发布后的文档修订不改变已发布安装包和 Git tag。核查方法见[文档修改](testing.md#文档修改)。
