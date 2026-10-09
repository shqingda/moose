# 面试材料怎么读

这组文档分两类：**项目经历**（讲 Moose 本身）和**通用练习**（前端与 AI 应用题、代码审查、Agent 专题）。项目描述以 **Moose 0.23.1** 源码为准（核对日期：2026-10-09）；历史测量数字保留当时的版本和条件，不代表当前版本重新测过。

通用练习里的示例方案和他人经验，不能当作 Moose 已实现的证明；反过来，Moose 的实现也只是一种做法，不是标准答案。

## 按目的选文档

| 你要做什么 | 读哪份 | 读到什么程度 |
| --- | --- | --- |
| 准备项目介绍 | [项目面试指南](project-interview-guide.md) | 能讲清用途、职责和一条任务链路，再挑两个难点 |
| 回答“为什么这样设计” | [项目追问资料](project-interview-reference.md) | 被问到时按话题查，顺着源码说明失败路径和验证范围 |
| 练前端与 AI 应用基础题 | [题目](questions.md) → [答案](answers.md) | 先自己答，再对照答案查漏；每题可直接跳转 |
| 练现场代码审查 | [React 搜索组件](react-search-results-code-review.md) | 说清错误现象、出现顺序、修复方法和复现方式 |
| 准备 Agent／Skill 专题 | [追问备忘](agent-skill-interview-retrospective.md) | 理解通用设计，不把假设的参数或他人的数字当成项目事实 |

## 建议的准备顺序

1. **一分钟介绍**：读[指南](project-interview-guide.md#一分钟介绍)，能用自己的话说出“这是什么、我负责什么、最难的是什么”。
2. **一条完整链路**：用“修登录按钮”走一遍任务流程，并打开 [service.ts](../../electron/service.ts)、[session-execution.ts](../../electron/session-execution.ts)、[store.ts](../../electron/db/store.ts)、[providers/types.ts](../../electron/providers/types.ts) 和 [workspace.ts](../../src/lib/workspace.ts) 对照。要能回答：输入怎样保存？在哪个目录执行？谁决定调用工具？状态怎样回到页面？中断后用户看到什么？
3. **两三个难点讲透**：不必全背，按岗位挑选。
   - 前端：[流式消息一致性](project-interview-reference.md#6-流式消息和-react-页面如何保持一致)、[搜索、通知与文件预览](project-interview-reference.md#19-搜索通知和文件预览怎样串起用户体验)
   - 后端／系统：[排队与恢复](project-interview-reference.md#7-排队并行和重启恢复)、[四个可展开的案例](project-interview-reference.md#16-面试里值得展开的四个问题)
   - Agent／协议：[适配器](project-interview-reference.md#5-不同代理如何接进同一套界面)、[Plan、Goal 与插话](project-interview-reference.md#8-plangoal-和运行中插话)
4. **检查有没有说过头**：过一遍[容易说过头的话](project-interview-reference.md#最后检查这些话有没有说过头)，直到右边那一栏能自然说出口。
5. **准备演示和一处自己改过的代码**：按[演示安排](project-interview-reference.md#三到五分钟的演示怎么安排)跑一遍，并准备一个“发现问题 → 修改 → 验证”的真实例子。

通用题按目标岗位补充，不需要先背完 84 题。

## 三组容易混淆的概念

- **请求被接收、任务开始、任务结束**是三个不同时刻。发送接口返回，不代表模型已经完成。
- **界面重连、原生会话续接、活进程恢复**是三种不同能力。能读回聊天记录，不代表已经退出的 Shell 能复活。
- **方案示例、自动化测试、真实系统验收**能证明的范围不同。模拟“权限被拒绝”，不能证明点过系统的授权弹窗。

## 事实以哪里为准

日常操作查[使用指南](../usage.md)，各底座支持什么查[能力表](../providers/native-capabilities.md)，测试条件查[测试指南](../testing.md)，各版本的验收数字查[发布记录](../releases/)。这些主文档负责记录事实，面试材料负责解释问题和取舍。
