# 第一阶段低成本验收

## 首选：零模型 token 的自动化验收

在仓库根目录运行：

```sh
pnpm test
pnpm test:e2e --grep 'automatic native delegation|reviews, edits|steers the active|retains rejected steering'
```

如果在构建时遇到 `vite: exec: node: not found`，先运行 `command -v node`。独立安装的 pnpm 能运行，并不代表子进程能从 PATH 找到 Node。本机 Apple Silicon Homebrew 的 Node 位于 `/opt/homebrew/bin/node`，可用下面的命令临时补齐 PATH，再运行验收：

```sh
PATH="/opt/homebrew/bin:$PATH" pnpm test:e2e --grep 'automatic native delegation|reviews, edits|steers the active|retains rejected steering'
```

这个写法只影响本次命令，不修改全局 shell 配置。如果该路径下也没有 Node，需要先安装 Node 或将实际 Node 安装目录加入 PATH。

这些用例用临时数据库和确定性的 CLI 替身启动真实 Electron，不连接模型、不使用真实登录、不修改正式会话。前一条覆盖服务边界；后一条验证：

- Codex／Grok 不需要子代理按钮，底座发送的委派活动与结果正常展示并保存。
- 原生计划卡片可修改，版本递增；刷新后仍在；批准后仅执行修改后的正文，并恢复执行权限。
- “立即发送”留在当前回合，不产生队列项；刷新后显示接收状态。
- 插话模式不匹配时拒绝并保留输入；底座断连时显示结果未知、不自动重试。

截图写入 `test-results/native-plan-review.png`、`native-steering.png` 和两个底座的 `*-subagents.png`。测试替身验证的是 Moose 的接入与界面，不能证明某个真实模型一定会主动委派。

## 可选：实际安装包的最小冒烟

0.8.0 已用真实 Codex 验证过 Plan、批准执行和插话，通常无需重复消费额度。若想自行确认，选择最低推理强度和自己可用的低成本模型，使用空临时目录，避免扫描现有大项目。

1. 输入 `/plan`，选择计划模式，再发送：
   > 只制定一步计划：新建 hello.txt，内容为 OK。无需澄清，不读取其他文件，不执行，计划限一句话。
2. 应看到计划卡片，目录中尚无 hello.txt。点击“修改计划”，把内容改为 HELLO，保存并刷新，确认版本增加且正文保留。
3. 点击“批准并执行”，检查 hello.txt 内容为 HELLO，且不能再次批准同一版本。

这需要一次规划、一次执行，具体费用取决于模型、上下文及工具使用，不承诺固定 token 数。无需开启 Goal，也无需为测试强制创建子代理。

插话最省成本的验证方式仍是上面的自动化用例。真实验证可等下一次正常 Codex 任务运行时发送“最终回复请用中文，限三句话”，点击“立即发送”；应显示已加入当前回合，队列不增加。若任务已结束，明确拒绝属于正常竞态，输入应保留。不要为了测试反复让模型长时间运行。

不要默认运行 `scripts/check-native-workflows.ts`：它会调用真实模型，适合底座升级后需要重新核查协议时使用。
