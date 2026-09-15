# 测试与验证

## 0.6.1 验证范围

35 项单元测试和完整复跑的 15 项 Electron 测试通过；真实 pnpm Pi 路径发现、版本查询、签名和安装包启动验证通过。详情见 [0.6.1 发布记录](releases/0.6.1.md)。

## 0.6.0 验证范围

本次运行通过：格式检查、Oxlint、TypeScript、生产构建、31 项单元测试、14 项 Electron 端到端测试。初始化阶段取消的保护补充后，单元测试及 Pi Electron 流程再次通过。

Pi 0.85.1 真实 CLI RPC 握手通过；环境未配置 Pi 模型，真实模型生成尚未验收。自动化的 Pi 输出、工具、确认、取消和会话恢复使用协议 fixture，不应表述为真实模型验收。Codex / Grok 的历史真实验证见 [历史验收档案](releases/validation-history.md)，其中的账号额度状态仅代表当时情况。

## 运行方法

```sh
pnpm test                  # 单元测试
pnpm test:e2e              # 构建后使用临时数据和测试 CLI 验证 Electron
pnpm test:providers        # 系统 CLI 握手和能力探测，不发送模型任务
pnpm test:live             # Codex / Grok 真实模型流程，会消耗额度
pnpm exec tsx scripts/package-smoke.ts  # 打包后的版本、签名、沙箱、SQLite
```

fixture 只用于测试，不打入应用。真实模型脚本在临时 Git 仓库工作。测试通过不代表所有代理、会员、模型和机器均经过实机验证；没有进行耗时或吞吐基准测试，不提供推测的性能提升数字。

安装包验证结果记录在对应 [Release](releases/0.6.0.md)，历史记录不覆盖。
