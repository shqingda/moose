# 第四阶段：Git 与原生审查验收

状态：已实现，纳入 0.10.0。0.9.0 安装包包含第二、三阶段，不包含本页新增功能。

## 最小成本复测

以下测试使用临时真实 Git 仓库、本地 bare remote、模拟 Codex／GitHub CLI；不调用真实模型，不创建远端 PR，不修改你的项目分支。

```sh
PATH="/opt/homebrew/bin:$PATH" pnpm test:e2e --grep 'stages exact files|previews explicit PR'
```

更快的后端边界测试：

```sh
PATH="/opt/homebrew/bin:$PATH" pnpm exec vitest run tests/unit/git-actions.test.ts tests/unit/review-workbench.test.ts
```

`PATH` 前缀解决终端能找到 pnpm、却找不到 node 的情况；Node 安装在其他位置时替换对应目录。

## 入口与行为

打开右侧“审阅改动”，所有操作使用当前会话的实际目录，包括受管 worktree。

- 每个文件可暂存或取消暂存；仅作用于对应文件（Git 识别出的重命名包含原路径）。暂存单位是文件，不提供逐 hunk 暂存。
- “提交预览”列出完整暂存文件清单及 diff。提交前核对分支、HEAD 和完整暂存区指纹；变动后需重新预览。失败保留提交说明，并在对话框显示错误。
- 保留 Git hooks 和签名配置。提交后核对实际树；如果 hook 或外部程序改变内容，明确报告已创建的 commit，要求检查，不伪造正常成功，也不自动撤销。
- 合并、rebase、cherry-pick 等未结束时阻止普通暂存／提交；受管合并继续使用 Worktree 面板的冲突处理。
- “拉取请求”要求安装并登录 `gh`，且 `origin` 为 github.com。输入目标分支，预览当前已推送分支到目标分支的提交与 diff；创建前再次核对仓库、HEAD 和远端目标。现有 OPEN PR 返回原链接，显示 OPEN／CLOSED／MERGED 状态。
- PR 预览会 fetch 选定 base，以本地 Git 对象生成 diff；不会检出分支或合并。当前不自动 push、不支持跨 fork、企业版 GitHub 或其他托管平台。创建的是草稿 PR。
- “原生代码审查”支持 Codex 0.155+，可选未提交改动、相对分支或指定提交。调用新 `thread/start` 后的 inline `review/start`，使用只读 sandbox／禁止权限提升；保留所选模型和推理强度，不恢复执行线程。
- 审查独立保存目标、native ID、正文、状态及错误；展示底座给出的文件路径和行号，可单独停止。窗口关闭后服务继续；退出／重启时未确认结果标为未知，不自动重新调用模型。

## 持久化与限制

提交和 PR 请求在执行前保存意图及 request ID。同一 ID 不重复执行；异常断开时保守记录结果未知。刷新 Git 或 PR 状态后再由用户选择下一步。审查结果保存在独立记录，不写入执行会话历史。

Moose 的目录锁约束自身代理、Git 操作与审查，不能锁住外部终端或其他客户端；预览后应避免同时从其他工具改动同一 checkout。截断 diff 明确提示，二进制改动由 Git 描述，完整文件清单仍保留。普通提交不用于完成冲突合并。

本轮原生审查验证基于仓库已核对的 Codex 0.155 协议类型与严格 fixture，覆盖独立只读线程、目标参数、结果事件、无关线程完成通知、停止与退出。为了省模型 token，没有调用真实模型做新审查，也没有用真实 GitHub 创建测试 PR。

## 本次验证记录

2026-09-19 发布前复核：86 项单元测试、完整 27 项 Electron 回归通过；路径处理最终调整后，7 项 Git 操作测试再次通过。类型检查、Lint、格式检查与 `git diff --check` 通过。构建仅保留已有的大 chunk 提示。

新增场景覆盖：子目录暂存与 diff.relative 完整预览、字面路径与未暂存内容隔离、无首个提交时取消暂存、重命名后继续编辑、陈旧 HEAD／index、hook 拒绝及修改提交树、冲突拒绝、worktree 目录归属、重复请求、PR 已发布 head／base 漂移／精确正文、独立只读审查、无关线程通知、停止／退出／重启、禁用底座和不支持的交互问题。
