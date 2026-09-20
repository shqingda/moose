# 文档入口

日常只需要看下面几份。使用方法、实现原理和面试讲法分别维护，不再同时维护两份项目经历。

| 目的 | 入口 |
| --- | --- |
| 安装、登录、桌面操作 | [使用指南](usage.md) |
| 浏览器运行与 OpenCode v2 | [Web 使用说明](web.md) |
| 理解实现、定位源码 | [技术架构](architecture.md) |
| 本地开发、测试与打包 | [开发与打包](development.md) · [测试与验证](testing.md) |
| 准备简历和项目面试 | [项目经历与面试指南](interview/project-interview-guide.md) |

原 `project-experience.md` 已合并到面试指南：项目介绍、职责、技术取舍、简历写法和实现讲解以这一个入口为准。

## 按需深入

<details>
<summary>代理能力、实施计划与专题验收</summary>

- [原生能力与当前缺口](providers/native-capabilities.md)
- [能力实施计划与历史进展](providers/native-capabilities-plan.md)
- [Pi 接入](providers/pi.md)
- [Plan 与插话验收](providers/phase-one-testing.md)
- [配置与扩展验收](providers/phase-five-testing.md)
- [后台命令与调度验收](providers/phase-six-testing.md)
- [Roost / DeepSeek Harness 调研](research/web-ui-and-roost.md)

</details>

<details>
<summary>面试补充练习</summary>

- [题目](interview/questions.md) · [答案](interview/answers.md)
- [启动到会话完成的源码追踪](interview/start-to-session-end.md)
- [协议适配专题](interview/coding-agent-adaptation.md)

这些是专题材料，不是第二份项目介绍。

</details>

## 发布记录

当前版本：[0.15.0](releases/0.15.0.md)。本机 Web 与共享后台为实验入口，启动方式见 Web 文档。

历史说明在 [releases 目录](releases/)，只记录当时交付与验证结果，不持续改写成新版本说明。

## 维护约定

- 使用步骤写入 usage 或 web；源码职责写入 architecture；开发命令写入 development；验证事实写入 testing。
- 面试指南统一维护项目定位和经历；具体 CLI 名称只用于解释协议差异或能力边界。
- 研究方案不等于已经实现；夹具测试不等于真实模型调用；开发增量不等于已经发布。
