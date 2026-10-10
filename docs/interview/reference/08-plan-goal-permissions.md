# 计划模式、目标模式与三档权限

> 源码基准 **Moose 0.23.3**（核对日期：2026-10-10）。Codex 的协议时序和计划批准事务仍在[第 8 节](03-execution.md#8-plangoal-和运行中插话)。产品会改，回答时带上文档日期，链接在文末。

## 30 秒怎么答

**一句话**：计划模式和目标模式都是宿主（跑代理的那个程序）的状态。权限三档是另一条轴，决定工具能不能跑。

计划模式是先只读地出方案，人批准某一版之后才按那一版改代码。目标模式是一条持久目标：模型每一轮自己选下一步；这一轮结束后，由运行时看目标还在不在、预算够不够、线程是不是空闲，再决定要不要自动开下一轮。完成要对照证据。预算或额度用尽是停，不能当成做完。

可以收成四个词：**持久目标 + 一轮一轮的代理循环 + 完成检查 + 预算**。模型决定下一步，运行时决定能不能继续。

Moose 0.23.3 给 Codex、Grok Build、Pi、OpenCode 都放了计划、目标和三档权限（请求批准、帮我批准、完全访问）。CLI 有原生接口就用原生的；没有就用只读提示、拒绝会改动的工具，或在审批回调里代选。只有 Codex 会在回合结束后按原生目标状态继续等下一轮。其余三家等这一轮结束就停。

## 1. 先把两个开关分开

**一句话**：界面上是两个独立选择，存在不同字段里。

```ts
// 两条轴。任务模式管「这一轮交付什么」，权限档管「工具要不要人点头」。
type TaskMode = 'build' | 'plan' | 'goal'; // PromptContext.mode，没保存过是 build
type Permission = 'ask' | 'auto' | 'full'; // Session.mode，没保存过是 auto

// 计划盖过权限。会话就算完全访问，计划这一轮仍然拒绝会改动的工具。
// 人批准某一版之后，执行轮回到 build，并恢复会话原来的权限。
if (taskMode === 'plan') denyMutatingTools();
```

- 界面文案：构建、计划模式、目标模式；请求批准、帮我批准、完全访问。
- 新安装和空档位都收成帮我批准。探测缓存里即使只剩「完全访问」，也不会把用户抬上去。回退顺序是帮我批准，然后才是请求批准。
- 输入框里打 `/` 并选中候选项之后，这段斜杠文字会从草稿里删掉，只把 `mode` 放进发送上下文。正文里打出 `/plan`、又没选中候选项，模式不变。Grok 的目标模式例外：适配器会在正文前加上 `/goal `。
- 可选的 `goalBudget` 是 1000 到 1,000,000 的整数。输入区没有预算控件。调用方不传，Codex 就不写 `tokenBudget`，其他底座也不附加预算那一行。

## 2. Plan 和 Goal 是宿主概念

**一句话**：代理循环每次都一样小。差别是谁决定还要不要再转一圈。

```ts
// 示意，不是 Moose 的某一个函数。
// 模型只产生下一步；while、执行和「要不要再来」属于运行时。
while (goal.status === 'active' && withinBudget && threadIdle && !userQueued) {
  const action = await llm(contextWithObjective);
  context.push(await execute(action));
  goal = await readGoal(); // 完成看证据；预算用尽记成 budgetLimited
}
```

计划模式：宿主把这一轮收成只读，模型交出方案。人批准的是那一版正文。

目标记在这一条线程上。换会话就没了，仓库里的说明文件也不算。续跑条件就是上面那个 `while`。Codex 另外还有两条：只做计划的工作不续跑；某一轮一个工具都没调，下一次自动续跑会被压住。

状态六种：`active`、`paused`、`blocked`、`usageLimited`、`budgetLimited`、`complete`。模型可以发起目标，有证据才能标完成。暂停、恢复、清除和预算用尽由用户或系统决定。证据是文件、命令、测试或生成物。

主流产品各写各的，面试时分开说：

- Claude Code 的 `/goal` 是当前会话的完成条件，外面包一层 Stop hook。轮次结束后，另一个小模型只读对话里已经有的内容，回答「还没达到 / 达到了 / 不可能」。它不跑命令、不读文件，也不改权限。没有单独的 token 预算字段，限轮数就写进目标句子。`--max-turns` 只管 `claude -p`。恢复会话会带回没做完的目标，轮数、计时和 token 计数从头算。
- Grok Build 公开文档有 `/plan`、权限模式和 `--max-turns`。没有和 `thread/goal` 对等的状态。
- Pi 默认没有计划模式，也没有目标状态机。Moose 没去装官方那个扩展示例。
- OpenCode v2 有 plan 代理，没有跨回合的目标表。

## 3. Moose 怎样驱动 Codex 的目标

**一句话**：Codex 自己在线程空闲时开下一轮。Moose 负责写入目标、先跑用户这句话、然后看状态。

以「把项目里的类型错误修完」为例。源码后半段是等 `turn/completed` 再查一次，这里写成循环，方便看时序：

```ts
// 形状来自 electron/providers/codex.ts。等待期间 Moose 不另发一条「继续」。
await rpc.request('thread/goal/set', {
  threadId,
  objective, // 超过 4000 字直接拒绝，不会发给 CLI
  status: 'paused', // 先用这次 turn/start 跑用户原话
  ...(goalBudget ? { tokenBudget: goalBudget } : {}),
});
await rpc.request('turn/start', { threadId, input: userText });

let goal = await rpc.request('thread/goal/get', { threadId });
if (!terminal(goal.status)) {
  // terminal：complete、blocked、budgetLimited、usageLimited
  await rpc.request('thread/goal/set', { threadId, status: 'active' });
  while (goal.status === 'active') {
    await waitNextTurnCompleted(); // 下一轮是 Codex 在空闲时自己开的
    goal = await rpc.request('thread/goal/get', { threadId });
  }
}
// 用户停止或连接关闭：仍是 active 就尝试改回 paused。这段等待没有单独的 Moose 超时。
```

`thread/goal/set` 失败就退回一轮提示，正文前加上 “Goal mode is active…”，跑完即停，不再查状态。Grok、Pi、OpenCode，以及这次失败退路，都到不了上面的 `while`。

进入等待之后，某一轮结束时状态已经离开 `active`，界面会收到 `Goal: <status>`。第一轮结束就已经是完成、受阻或达到上限时，任务直接结束，不一定有这行。Moose 不自己重跑测试，它读 CLI 报上来的状态。到底是 `complete` 还是 `budgetLimited`，看 Codex 有没有把证据写进目标。

计划的批准时序仍以[第 8 节](03-execution.md#8-plangoal-和运行中插话)为准。0.23.3 和 Codex 的交界就这几条：

- `collaborationMode/list` 里有 `plan`：这一轮协作模式用 `plan`，正文不加计划提示。
- 没有：协作模式用 `default`，正文前加只读计划提示，助手正文收成可审阅的计划。
- 两种都会把沙箱改成 `read-only`、审批策略改成 `never`，并直接拒绝这一轮的命令、文件和提权。会话平时是完全访问也一样。
- 「批准并执行」在同一个事务里记下这一版，把带版本号的计划正文排进构建模式。计划结束会暂停队列；批准取消暂停并开始执行。同一版不能批准两次。

## 4. 0.23.3 四家分别怎么接

**一句话**：有原生接口就走原生接口。没有，就用提示和代选，不额外多跑一轮。

| 底座 | 计划模式 | 目标模式 | 回合结束后 |
| --- | --- | --- | --- |
| Codex | 有原生 `plan` 就用；没有就加只读提示。沙箱始终只读，写操作直接拒绝 | `thread/goal/set` / `get`。失败才退回一轮目标提示 | 只有这条会继续等 |
| Grok Build | 正文加只读提示，权限回调里拒绝会改动的工具。不调用未验证的 `session/set_mode(plan)` | 正文前加上 `/goal` 和目标原文，有预算再加一行 | 等这一次 `prompt` 返回 |
| Pi | 正文加只读提示；看到会改动的工具就中止这一轮 | 正文加目标提示，等 `agent_settled` | 不再开一轮 |
| OpenCode v2 | 配置里列出了 `plan` 就选中它，同时加只读提示，回调也拒绝会改动的工具 | 正文加目标提示 | 等这一次 `session/prompt` 返回 |

权限三档别记成同一组参数。代选在 `modes.ts`：先看是不是计划，再看权限档。没有对应选项就问用户。

```ts
// 示意。toolMutates 靠工具名和标题里的 read / grep / bash / write 认「会不会改」。
if (taskMode === 'plan') {
  if (!toolMutates(name, title)) return allowOnce ?? allowAlways ?? askUser;
  if (reject) return reject;
  return askUser;
}
if (permission === 'ask') return askUser;
if (permission === 'full') return allowAlways ?? allowOnce ?? askUser;
return allowOnce ?? allowAlways ?? askUser; // 帮我批准：优先一次性允许

// 同一档，四家各写各的：
// Codex    ask / auto → on-request + workspace-write，审批人 user 或 auto_review；网络和网页搜索关掉
//          full → never + danger-full-access
// Grok     ask → --permission-mode default，并先发 /always-approve off
//          auto → --permission-mode auto，弹窗时选一次性允许
//          full → --always-approve，弹窗时选始终允许
// Pi       ask 或计划：会改动的工具直接中止。auto 和 full 放行同一组工具
//          --approve 只表示信任项目目录里的扩展
// OpenCode ask 把 request_permission 交给用户，不改用户的权限配置
//          auto 选 allow_once；full 选 allow_always（CLI 提供时）
```

认错工具名，就可能把会写文件的工具放行，或把只读工具拒绝掉。这是 Moose 的补齐，各 CLI 自己的沙箱另外算。

## 5. 和主流产品的权限怎么对上

**一句话**：先说对应的是哪一条轴，再说差在哪。

- 请求批准更接近 Claude Code 的 `default`、Grok 的 Ask、OpenCode 的 `ask`。各家的只读工具往往默认放行。
- 帮我批准更接近 Codex 的 `auto_review`、Claude Code 的 `auto`、Grok 的 Auto、OpenCode 的一次性 `allow`。Claude Code 的 `acceptEdits` 主要自动接受工作区内的文件编辑。
- 完全访问更接近 Codex 的 `danger-full-access`、Claude Code 的 `bypassPermissions`、Grok 的 always-approve。Pi 没有更宽的沙箱，这一档和帮我批准跑同一组工具。
- Claude Code 把 plan 放在权限模式里。Grok 和 Moose 把它放在权限旁边，批准前限制编辑。

Grok 和 Claude Code 都有宿主侧的 `--max-turns`。Codex 用的是线程上的 token 预算，用尽进入 `budgetLimited`。Moose 只在调用方传入 `goalBudget` 时，把这个数字交给 Codex，或写进 Grok 和提示文本。

## 6. 不要说成

- 「`/goal` 就是系统提示里写一句做到完。」这只是 Pi、OpenCode，以及 Codex 接口失败时的退路，而且只活一轮。
- 「四家都会在回合结束后自动开下一轮。」只有 Codex 这条原生路径会。
- 「帮我批准等于完全访问。」Codex 的自动复核仍在 `workspace-write` 里；ACP 的帮我批准选的是一次性允许。
- 「Moose 会自己跑测试来宣布目标完成。」它读的是 CLI 的目标状态。
- 「Claude Code 没有目标。」2026-10-10 的官方文档有 `/goal`，是会话级的第二次评判，不是 Codex 那张带预算字段的线程目标。
- 「Claude Code 的评判模型会自己跑测试。」官方写明它只看对话里已经出现的内容。
- 「Pi 的 `--approve` 是完全访问。」那是项目信任，决定是否加载项目里的扩展和设置。
- 「输入区可以设 token 预算。」协议留了字段，界面没有这个控件。
- 「计划模式就是把权限设成请求批准。」计划是任务模式，这一轮单独收成只读。

代码入口：[modes.ts](../../../electron/providers/modes.ts)、[codex-permissions.ts](../../../electron/providers/codex-permissions.ts)、[codex.ts](../../../electron/providers/codex.ts)、[grok.ts](../../../electron/providers/grok.ts)、[pi.ts](../../../electron/providers/pi.ts)、[opencode.ts](../../../electron/providers/opencode.ts)、[plans.ts](../../../electron/plans.ts)、[selection.ts](../../../shared/selection.ts)、[validation.ts](../../../shared/validation.ts)。日常操作见[使用指南](../../usage.md)，支持范围见[能力表](../../providers/native-capabilities.md)。

## 来源

核对日期 2026-10-10。

- Codex 目标：[Using Goals in Codex](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex)、[Follow a goal](https://developers.openai.com/codex/use-cases/follow-goals)。空闲后续跑可以对照仓库里的 `continue_if_idle`（`codex-rs/ext/goal/src/runtime.rs`）。
- Claude Code：[goal](https://code.claude.com/docs/en/goal)、[permission modes](https://code.claude.com/docs/en/permission-modes)、[CLI `--max-turns`](https://code.claude.com/docs/en/cli-reference)。
- Pi：[coding-agent README](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md)、[settings（`--approve` 是项目信任）](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md)、[plan-mode 扩展示例](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/plan-mode/index.ts)。
- OpenCode v2：[Permissions](https://opencode.ai/v2/docs/permissions/)。
- Grok Build：[Plan Mode](https://docs.x.ai/build/features/plan-mode)、[Permissions](https://docs.x.ai/build/features/permissions)、[CLI reference](https://docs.x.ai/build/cli/reference)。

---

上一篇：[搜索、通知与文件预览](07-search-notice-preview.md) ｜ [追问资料目录](README.md)
