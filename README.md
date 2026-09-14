# Moose

A quiet, local macOS workspace for **Codex** and **Grok Build**. Built for Apple Silicon with Electron, TypeScript, React, Vite 8, shadcn / Base UI, Tailwind, and SQLite.

Moose talks to your installed agents. Their official CLIs own authentication, model access, tool execution, and subscription usage. There is no Moose account, cloud backend, telemetry, or credential database.

## Development

Requires macOS on Apple Silicon, Node.js 26.8.2 (the tested version in `.node-version`), pnpm 12.4.1, and Xcode Command Line Tools.

```sh
pnpm install
pnpm dev
```

The install step downloads Electron and prepares the native SQLite dependency. `vite-plugin-electron` builds the main process, sandboxed preload, and utility runtime. React gets HMR; preload changes reload the window; main/runtime changes gracefully restart Electron after all build targets are ready.

```sh
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm test:providers   # Real CLI handshake/authentication; no model prompts
pnpm test:live        # Real model requests; creates temporary Git repositories
pnpm dist            # release/Moose-0.5.5-arm64.dmg
```

`pnpm test:live` uses provider quota and edits only freshly created temporary test repositories. Protocol fixtures are confined to `tests/` and are not shipped in the application.

## Connecting agents

- [Codex CLI](https://developers.openai.com/codex/cli): install and run `codex login` using the account you want Moose to use.
- [Grok Build](https://docs.x.ai/build/overview): install and sign in through the official CLI with your Grok/SuperGrok account.
- Open Moose → Settings → Agent connections, optionally provide an absolute executable path, then save and reconnect.

Codex is discovered from your system, including Homebrew at `/opt/homebrew/bin/codex`. Moose does not install or bundle Codex. Generated protocol types are retained from Codex 0.154.0; `pnpm protocol:generate` uses your installed CLI. Model lists come from the CLI, not a hardcoded catalog.

## Working in Moose

Open a local project, choose an agent, and send a request. `⌘N` creates a session; `⌘K` searches session titles and project names; `⌘,` opens Settings. Enter sends, Shift Enter inserts a newline, and IME composition does not submit.

- Sessions retain their provider. Create another session to use a different agent.
- Each canonical project directory runs one Moose task at a time. Other directories can run concurrently. This does not lock out external CLI sessions or editors.
- Followup messages queue while an agent runs. Edit or remove them before execution. Stopping or restarting preserves the queue; explicitly resume it when ready.
- Approval and question cards reflect provider requests. Moose does not enable blanket permission approval.
- Changes shows **all** staged, unstaged, and untracked working-tree changes, including edits that existed before the agent ran. It does not attribute every diff to the agent or perform destructive Git operations.
- Previews are capped at 256 KB. Binary files are identified; untracked symlinks display the link target without opening it.
- Closing the window keeps tasks running. `⌘Q` cancels active work and closes the runtime. Reopening an interrupted session does not automatically re-send a prompt.
- Finder opens the project directory. Open in editor honors a registered source-code editor, then falls back to installed Cursor, Visual Studio Code, or Zed.

## Architecture

```text
React renderer
  ↕ validated, allowlisted IPC through contextBridge
Electron main — native windows, menus, folder picker, external opening
  ↕ private utility-process messages
Moose runtime — session scheduler, Drizzle/SQLite, Git, provider adapters
  ├─ Codex app-server / stdio (versioned generated protocol types)
  └─ Grok agent stdio / ACP SDK
```

Application code is TypeScript/ES modules. Only the sandboxed preload artifact is emitted as one CommonJS file, as required by Electron's sandbox. The renderer has no Node.js access. Navigation and permission requests are restricted, Markdown cannot execute HTML/scripts, and external links are restricted to HTTP(S).

Projects, sessions, drafts, queue items, messages, and native provider session IDs live in `moose.sqlite` under Electron's `userData` directory. Development uses `~/Library/Application Support/Moose Dev`; release uses `~/Library/Application Support/Moose`. Provider credentials remain with the providers. `MOOSE_DATA_DIR` overrides the data directory for isolated tests.

Database migrations run transactionally at startup. A newer database version is rejected rather than downgraded. Message IDs, execution generations and sequence numbers deduplicate streamed updates; transcripts load 80 records per page and use content-visibility rendering through shadcn's message scroller.

The palette, mark, layout, and motion are original to Moose. Waku was studied as a behavioral reference; no Waku implementation, icons, or screenshot assets are included. The frontend uses system fonts, restrained sea-pine accents, a native translucent sidebar, reversible springs, and accessibility preferences for motion, transparency, and contrast.

## Packaging

The release is for local use and has no Developer ID signature, notarization, updater, or publishing configuration. `electron-builder` rebuilds/collects the native SQLite module and unpacks `.node` files from ASAR. The original app icon is checked in; regenerate it with `pnpm icon:build`.

Hono, Cloudflare, worktrees, embedded terminals, file editing, browser automation, CLI-history import and cloud sync are deliberately outside this version.

See [validation notes](docs/validation.md) for checks actually performed and external limitations.

## Conversation controls

- Project menus archive all conversations or delete the project from Moose, with confirmation. Deletion removes Moose history, never the code directory or official CLI history. Stop running tasks first.
- Conversation archive requires confirmation; restore is available from the archive. Message actions copy text, edit your previous prompt, or continue from an earlier turn. Original conversations are preserved. Code changes are **not reverted**.
- Codex uses a native fork at a completed turn when its ID is available. Grok and older messages without checkpoints restore visible conversation history into a new session; this is not a byte-for-byte restore of hidden model state.
- Paperclip, file drop and image paste attach up to 10 files, 20 MB each. Files are copied to local userData and retained with drafts/queues/history. Images use native Codex image input; text files up to 1 MB include contents, other files are passed as local file references for the agent's tools. Video is not supported. Grok 1.0.30 reports no ACP image support; Moose disables sending images to that provider.
- Codex permissions: Request approval uses workspace-write with network disabled and user review; Approve for me uses the same sandbox with Codex auto_review; Full access uses danger-full-access and never approval. Grok exposes normal approval and full access; this CLI does not advertise risk-based auto review over ACP.
- Cmd+B toggles the sidebar and remembers its state. Settings has separate General, Providers, and Setup guide pages.

### Composer context (0.4)

Type `@` to find current-project files or folders with fuzzy matching. Type `/` for Plan, Goal, and global/project skills. Use arrow keys and Enter or Tab to select; Escape dismisses the menu. File and skill references are ordinary editable text. Deleting their text also removes the corresponding context from the next send.

Plan currently requires Codex and runs read-only. Goal uses the provider's goal mechanism; Stop pauses Codex goal pursuit. Grok goal execution has not been live-verified with the currently exhausted account quota. Selecting a skill sends its verified local path to the agent; skills are discovered in `.agents/skills`, `.codex/skills`, and `.grok/skills` under your home and project directory.

## 项目经历与技术说明

[项目经历与逐项技术详解](docs/project-experience.md)：简历版本、实现原理、代码片段、测试依据及面试讲解边界。

Editing the latest user message opens an inline text editor; Send replaces that turn in the same conversation with the original attachments. Earlier messages support copying only. Clicking a project heading toggles its conversation list without changing the selected conversation. Projects can be removed from Moose; conversations must be archived before they can be deleted. Archiving the current conversation returns to a new composer, and new conversations appear in navigation after the first send.

### macOS 首次打开

0.5.5 起使用 ad-hoc 签名并在打包时验证完整性，尚未做 Apple 公证。下载后可能仍需在“系统设置 → 隐私与安全性”中选择“仍要打开”。详情见 [0.5.5 发布说明](docs/releases/0.5.5.md)。

### 代码格式与检查

使用 Oxfmt 格式化、Oxlint 检查，不依赖 ESLint。

```sh
pnpm format        # 格式化代码
pnpm format:check  # 检查格式，适合 CI
pnpm lint          # 基础正确性检查
pnpm lint:fix      # 应用安全的自动修复
```

统一使用 2 空格缩进、单引号、分号及 100 列换行。生成的 Codex 协议类型、锁文件和技术文档不参与格式化，构建产物遵循 Git 忽略规则。当前启用 TypeScript、Unicorn、Oxc 基础规则，暂未接入 React Hooks / React Compiler 检查；类型检查仍使用 `pnpm typecheck`。
