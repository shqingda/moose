# 文档入口

当前说明以 **0.17.0** 为基线。日常使用、实现原理和面试材料分别维护；历史发布记录只说明当时交付了什么。

| 你想了解什么 | 从这里开始 |
| --- | --- |
| 安装、登录、会话、终端与 Git 操作 | [使用指南](usage.md) |
| 浏览器入口、共享后台、目录选择与连接问题 | [Web 使用说明](web.md) |
| 进程分工、消息执行与数据存储 | [技术架构](architecture.md) |
| 本地开发、构建与发布 | [开发与打包](development.md) |
| 选择测试、后台验收与验证边界 | [测试与验证](testing.md) |
| 各代理已经接入哪些能力 | [底座能力与接入边界](providers/native-capabilities.md) |
| 已完成的阶段和后续范围 | [开发计划](providers/native-capabilities-plan.md) |
| 项目介绍、简历写法与技术追问 | [项目经历与面试指南](interview/project-interview-guide.md) |

## 专题与练习

- [Pi 接入细节](providers/pi.md)：自定义 JSONL RPC、完成信号与权限边界。
- [面试题目](interview/questions.md)与[参考答案](interview/answers.md)：通用前端和 AI 应用知识练习，不作为项目已实现能力的证明。
- [React 搜索代码审查练习](interview/react-search-results-code-review.md)。
- [Agent Skill 复盘](interview/agent-skill-interview-retrospective.md)：独立专题，与 Moose 的功能说明分开阅读。

项目经历、协议适配讲解和启动调用链统一放在面试指南中，不再维护多份项目介绍。

## 历史记录

- [0.19.1 发布说明](releases/0.19.1.md)；其他版本见 [releases 目录](releases/)。
- [阶段验收归档](releases/feature-validation-history.md)：原六份阶段验收的操作与证据，按当时版本解释。
- [早期验证记录](releases/validation-history.md)。
- [Roost / DeepSeek Harness 调研](research/web-ui-and-roost.md)：保留调研背景和原始方案，当前实现以使用指南、架构与开发计划为准。

## 维护约定

使用步骤写入使用指南；源码职责写入架构；开发命令写入开发指南；验证方法写入测试指南。能力支持范围集中在能力表，待办集中在开发计划，面试材料引用这些事实并解释取舍。

更新功能时同步修改对应主文档，不追加另一份内容相同的阶段说明。发布记录保留版本、验证条件和限制；协议夹具通过、真实 CLI 握手通过、真实模型任务通过必须分别说明。
