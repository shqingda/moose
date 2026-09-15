# 文档目录

日常使用从使用指南开始，开发维护从技术架构开始。当前实现以源码与 0.6.0 文档为准；面试示例和历史验收分别保留在自己的目录中。

| 你想了解什么 | 文档 |
| --- | --- |
| 安装、代理登录、日常操作与快捷键 | [使用指南](usage.md) |
| 一条消息怎样经过各进程，代码应该从哪读 | [技术架构](architecture.md) |
| 开发命令、格式规范、原生依赖和打包 | [开发与打包](development.md) |
| 测试怎么运行，哪些能力实际验过 | [测试与验证](testing.md) |
| Pi 如何接入、哪些能力不支持 | [Pi 接入](providers/pi.md) |
| 简历项目经历及逐点讲解 | [项目经历](interview/project-experience.md) |
| 面试复习题与对应答案 | [题目](interview/questions.md) · [答案](interview/answers.md) |

## 发布记录

- [0.6.0：Pi 支持与代理架构整理](releases/0.6.0.md)
- [0.5.5：图标与签名](releases/0.5.5.md)
- [0.5.4：交互与用量](releases/0.5.4.md)
- [早期验收档案](releases/validation-history.md)

## 文档维护约定

README 只负责介绍与导航。使用方法写入 usage，源码脉络写入 architecture，命令和交付写入 development，当前验证结果写入 testing。新增版本写独立 release note；历史数字不替换成新数字。面试材料中的教学示例不能当作已实现功能或性能成果。
