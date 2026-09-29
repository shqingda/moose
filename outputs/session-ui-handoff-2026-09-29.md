# Moose 本次会话交接记录

日期：2026-09-29  
项目：/Users/shqingda/Projects/moose  
来源会话：01a0ed30-57b2-7a31-8738-ba633da33112  
接收会话：查看 Moose 未完成事项（01a0ecac-0dfd-7f92-9d6c-00166df381ce）

## 当前状态

本次用户要求的 UI 改动均已实现并完成针对性验证。尚未提交 Git、未升级版本、未发布。当前 package.json 版本为 0.21.0。

**工作区由多个会话共享，已有大量其他改动。不要将全部 git diff 视为本会话产物，也不要覆盖或回滚其他会话的工作。** 本文按功能说明本会话范围；最终提交前请逐段核对。

## 用户最终确认的要求与实现

### 1. Terminal 精简

- 删除空面板中的两段说明：打开 shell 的介绍，以及隐藏面板/退出客户端后终端存活的介绍。
- 保留新建终端、终端会话及关闭确认等实际操作。
- 相关文件：src/components/terminal-panel.tsx、src/components/background-tools.tsx。

### 2. 图片附件与复合控件悬浮

- 图片附件改为无边框缩略图，不显示文件名和 KB 大小；仍可预览、移除。
- 悬浮时整张缩略图统一变暗。
- 文件标签再次出现只有文件名区域变色、关闭按钮区域不变色的问题，根因是全局 button:hover 给内部按钮分别加底色。
- 引入 data-hover-surface，复合控件由外层负责整体悬浮背景，内部按钮不再叠加局部底色；图片保留独立整图遮罩。
- 应用于文件标签、终端标签、项目/会话行及附件。
- 文件标签主按钮填满标签，关闭按钮定位在右侧，保留独立关闭行为。
- 主要文件：src/app.css、src/components/attachments.tsx、files-panel.tsx、terminal-panel.tsx、sidebar.tsx。

### 3. 会话完成状态

用户起初要求完成对勾垂直居中，后来明确更正：**完成时完全不显示对勾**。

- completed 和 idle 均不显示状态图标。
- 运行中、等待确认、排队、失败、暂停等状态仍有相应反馈。
- pendingMessageId 优先显示等待状态。
- 文件：src/components/sidebar.tsx。

### 4. 右侧文件面板

- 文件预览由弹窗改为与 Review 共用位置的右侧面板；附件仍用原附件预览弹窗。
- 顶部 Files 按钮、消息本地文件链接、改动文件预览均可打开文件面板。
- 多文件标签、关闭、键盘切换、面包屑、复制、下载、刷新、换行、文件内查找。
- 项目文件树支持按需展开、文件名过滤与收起；按当前 session 的实际目录/worktree 读取。
- 目录接口隐藏 .git 和符号链接，单目录最多 2000 项，保留工作区路径边界校验。
- 支持图片显示与缩放、非文本提示、截断提示、文件删除后的错误与重试。
- 左边缘可拖动调整宽度；Web 窄窗口适配。
- 切换文件保留代码区滚动位置与行选择；聊天草稿不受影响。
- 文件引用处理了项目内绝对路径、file: URI 和相对路径。
- 新增文件：
  - src/components/files-panel.tsx
  - src/components/file-tree.tsx
  - src/components/code-preview.tsx
- 相关接入：
  - src/app.tsx
  - src/components/file-preview.tsx
  - shared/experience.ts、shared/validation.ts
  - electron/file-preview.ts、electron/service.ts
  - docs/usage.md

### 5. 最终代码组件是 Pierre，不是 Monaco

曾短暂实现 Monaco 0.57.0，随后按用户明确要求替换：

- **当前依赖：@pierre/diffs 1.5.1。Monaco 依赖及初始化代码已删除。**
- 使用 Pierre CodeView 虚拟化文件视图和 Shiki 高亮，shiki-js 引擎。
- github-light / github-dark 跟随应用主题；资源随应用本地打包。
- 仍是只读源码预览，没有保存文件编辑的功能。
- 文件内查找为大小写不敏感的匹配行查找，支持上/下一个、Enter/Shift+Enter；计数表示匹配行数。
- ⌘/Ctrl F 打开查找，Escape 关闭查找；FilesPanel 的 Escape 捕获让代码区和弹窗自行处理。
- 暂不支持之前 Monaco 的语法折叠，已告知用户并更新文档。
- electron/main.ts、electron/web-server.ts 中之前加入的 worker-src self blob CSP 仍在。
- package.json、pnpm-lock.yaml 已更新。

### 6. 文件面板展开 / 还原

- 右上角 Maximize2 / Minimize2 按钮。
- 展开后文件面板占满左侧项目栏以外的主区域，聊天区域隐藏但组件不卸载，草稿/会话保留。
- 还原后恢复之前的分栏宽度，展开状态下隐藏拖动分隔条。
- 关闭面板时重置展开状态，重新打开默认分栏。
- 使用 FilesPanel expanded 状态及 data-expanded，CSS 根据 :has() 控制聊天区可见性。
- 主要文件：src/components/files-panel.tsx、src/app.css、src/lib/experience-i18n.ts。

### 7. Markdown 默认预览与源码切换

- .md / .markdown / .mdown / .mkd 文件首次打开默认渲染预览。
- 工具栏“查看源码 / 预览”切换；源码仍为 Pierre。
- 按文件记住源码/预览模式；关闭该文件标签后清除模式，重新打开默认预览。
- 预览复用现有 Markdown 组件：
  - react-markdown 渲染；
  - remark-gfm 支持表格、任务列表等；
  - rehype-highlight（highlight.js）负责预览内代码块高亮。
- 未使用 Pierre 来渲染 Markdown 排版；Pierre 仅用于源码视图。
- Markdown 组件新增可选 basePath，使文件预览中的相对本地链接与图片按当前文件目录解析；原聊天 Markdown 不传 basePath，保持原逻辑。
- 外部链接仍经 openExternal；原有 skipHtml 策略保留。
- 预览中的查找/换行按钮隐藏，源码模式恢复。
- 修复“查看源码”文字按钮被通用 28px 图标按钮宽度限制导致重叠的问题，单独使用 file-mode-toggle 样式。
- 文件：src/components/markdown.tsx、files-panel.tsx、src/app.css、src/lib/experience-i18n.ts、docs/usage.md。

## 验证

已通过：

- pnpm build（包含 TypeScript 检查）
- pnpm typecheck
- 针对相关文件的 oxlint、oxfmt --check
- git diff --check
- 早期文件预览/目录功能：tests/unit/experience.test.ts 的 9 项测试
- 桌面/Web “searches old messages, previews local files, keeps errors and supports undo”测试在 Pierre 切换后通过。
- 桌面/Web “browses workspace files in a side panel and keeps tabs and drafts”通过，覆盖：
  - 文件树、链接打开、多标签、草稿保留；
  - Pierre 700 行文件的远处查找与标签滚动恢复；
  - 主题切换、换行、文件删除、窄屏；
  - 完成状态无图标；
  - 文件名、关闭按钮和标签边缘的统一 hover。
- 桌面/Web “expands files and previews Markdown by default”通过，覆盖：
  - Markdown 默认预览、源码切换、表格/任务列表/相对图片；
  - 相对链接跨 Markdown 文件打开；
  - 展开/还原宽度、聊天区隐藏和恢复、草稿保持；
  - 关闭并重开面板恢复分栏。
- 最后修复 Markdown 切换按钮宽度后重新构建并重跑以上展开/Markdown 两项测试，2/2 通过。

注意：没有声称执行完整测试套件。调试中旧 Monaco DOM/主题断言曾失败，已改成 Pierre 对应断言并通过。

可参考产物（test-results 会被后续测试覆盖）：

- test-results/files-desktop.png
- test-results/files-web-dark.png
- test-results/markdown-expanded-desktop.png
- test-results/markdown-expanded-web.png

## 编辑器调研结果（供背景参考）

用户问过 Codex Desktop、Cursor 新 UI、OpenCode Desktop、Waku 的组件。

- 本机 Codex（ChatGPT.app 中集成的 Codex，26.924.51851）安装包确认 pierre-file-editor、diffs-container、Shiki 模块。
- 本机 Cursor 3.22.12 新 Agents Window 包含 Monaco 编辑器实现，官方支持也提及 Monaco diff view。
- OpenCode 公开源码文件组件直接使用 @pierre/diffs。
- Waku 桌面公开源码使用 Rust/GPUI 自研 TextInput 与自研高亮。
- 这些是本次调研时核验的快照，不是对后续版本的保证。

## 交接与发布注意事项

- 本次仅做本地实现与验证，没有用户发布指令。
- 工作区中 distribution/*、scripts/runtime.mjs、scripts/update.mjs、docs/web.md、settings/transcript 等还存在其他会话或先前工作的修改；请按具体 diff 核对，不要整体归入本会话。
- 新的 files-panel.tsx / file-tree.tsx / code-preview.tsx 目前仍是未跟踪文件，提交时不要漏掉。
- 如后续发布，遵守 AGENTS.md 和 docs/development.md：package.json 为版本唯一来源；pnpm release:prepare 然后 pnpm release:publish；macOS 与 Web 必须一起发布并验证，不能只发布一端；保护现有工作区数据和活动任务。
