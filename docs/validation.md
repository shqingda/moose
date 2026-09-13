# Validation — 2026-09-13

Environment: Apple Silicon macOS, Node 26.8.2, pnpm 12.4.1, Electron 44.3.0, Vite 8.3.0, vite-plugin-electron 1.1.2.

## Passed

- Strict TypeScript check and production builds for renderer, main, preload, and utility runtime.
- 13 Vitest assertions/scenarios across four test files: transactional migration and restart, durable queues, event sequence deduplication, transcript paging, Git staged/unstaged/untracked states, Unicode/newline/space filenames, binary/large/symlink previews, traversal rejection, Codex/ACP normalization, IPC validation, per-directory concurrency, cancelled approvals, late events, and explicit queue resume.
- Three Playwright Electron scenarios: project picker → task → approval → actual fixture file write → Git diff; theme and language switching; 10,000-event history with 80-record paging, Chinese IME handling, renaming, archiving, restoring, and draft persistence across a full app restart; Grok ACP denial, custom questions, cancellation, and saved followups.
- UI screenshots inspected in light and dark mode, including settings, transcript and diff surfaces. Fixture screenshots are test evidence, not real model output.
- Development lifecycle smoke: first launch waits for all three Electron targets; renderer change is observed in the DOM; preload changes reload the page without restarting main; runtime/main changes restart Electron successfully. Temporary source changes are restored by the smoke script.
- Native SQLite works under both Node and Electron. The arm64 packaged application starts with sandbox enabled and can read its on-disk SQLite settings through the utility runtime.
- Local arm64 `.app` and `.dmg` generated with the original Moose icon. No Developer ID signing/notarization or updater is configured.

## Real provider checks

### Codex 0.154.0

- Authenticated app-server handshake and live model discovery passed.
- In a new temporary Git repository, the agent created `hello.txt` containing `moose-ready`.
- The CLI process was fully closed, a fresh one resumed the saved native thread, and appended `resumed-ok` without losing the first line.
- These local edits did not require an approval from the real CLI's workspace policy. Approval paths were separately verified through the deterministic test protocol peer.

### Grok Build 1.0.30 / SuperGrok

- ACP initialization, cached official login, model discovery, and native session creation passed.
- A real prompt was rejected by the provider with HTTP **402**, `Grok Build usage balance exhausted`.
- Real Grok file mutation and resumed generation therefore remain unverified until the account has usage available. The client preserves the detailed provider error instead of only displaying `Internal error`.
- ACP text/tool events, permissions, denial, the Grok question extension, and cancellation were verified with the explicit test fixture. Fixtures are not shipped in the application.

Run `pnpm test:live` after quota is available to repeat both live provider workflows. It uses quota and edits only fresh temporary Git repositories.

## Boundaries

- CLI protocols can evolve independently of Moose. Codex types are generated from 0.154.0; other versions receive capability/error handling but have not all been tested.
- This is a local-use release, not a signed public distribution.
- Keyboard/ARIA and reduced-motion styles are implemented; a full manual VoiceOver audit has not been performed.
- Moose preserves its own session history and provider continuation IDs. It does not import existing CLI histories or promise that work continues after Cmd+Q or an OS/process termination.

## 0.2.0 follow-up

- Homebrew Codex 0.154.0 is discovered successfully. The npm Codex dependency and local executable fallback were removed; generated protocol source remains.
- 19 unit scenarios now include v1 → v2 data migration, safe project removal, restoring visible history, retained attachments, permissions mapping, and actual diff line numbers.
- Five Electron E2E scenarios cover the original flows plus archive/delete confirmation cancellation, project archive restoration, native file selection, image/text protocol inputs, clipboard copy, edited history, and sidebar menu shortcut dispatch.
- Real Codex image + text test recognized the Moose icon and read `MOOSE_CHECKPOINT_427`. A native fork at the completed turn, followed by a fresh process resume, retained the code exactly. Repeat explicitly with `pnpm exec tsx scripts/check-revision.ts` (uses model quota).
- Grok 1.0.30 advertises `promptCapabilities.image: false` and no ACP risk-based auto-review control. The UI exposes only supported permissions and blocks image sends to that provider. File references/text attachments remain supported. No additional paid Grok generation was attempted.
- Returning to a historical point preserves the original conversation and does not undo code files. Codex uses native completed-turn forks when available. Older turns and Grok use visible-history context reconstruction, explicitly described in the confirmation.
- Default text is now 16 px, navigation roughly 15 px, common action icons 18 px, with a wider inline Git review and separate settings pages. The composer remains fully opaque when its fixed provider selector is disabled.

- Real Codex app-server confirmed the effective settings for all three permission modes: ask/user/workspaceWrite/networkAccess=false; auto/auto_review with the same sandbox; full/never/dangerFullAccess.

## 0.3.0 interaction and context update

- Default text is 15 px; common icons are 17 px and message actions 15 px with 28 px hit areas. User actions align under the right-hand bubble and reveal on hover or keyboard focus. Settings Back is a full-width 42 px row. Full access uses the destructive color token.
- Sidebar uses project groups, indented single-line conversations, quiet selection backgrounds and hover actions. Cmd+B animates a persistent sidebar with a critically damped spring; reduced motion is immediate.
- `@` searches files and folders with substring/subsequence ranking, excludes generated trees and symlinks, caps traversal at 25,000 entries, and verifies canonical containment again when sending. Chinese/space paths and macOS `/var` aliases are covered.
- `/` lists Plan, Goal, global and project skills from `.agents/skills`, `.codex/skills`, and `.grok/skills`. Arrow keys, Enter/Tab, Escape and IME composition are covered. Selected context persists in session drafts, queued inputs and user message records through schema v3.
- Codex receives typed mention/skill inputs. Plan uses read-only sandbox plus planning instructions and denies elevation. Grok Plan is unavailable because the installed ACP does not advertise that mode. Goal uses Codex's native persisted goal API and waits across native continuations; stopping pauses the goal. Grok sends its official `/goal` command, but live Grok goal generation remains unverified due to the previously exhausted account quota.
- `scripts/check-modes.ts` passed against Homebrew Codex 0.154.0: referenced-file reading, read-only planning, and a goal completed by the real model. The isolated test file remained unchanged. This script consumes model quota when explicitly rerun.
- 22 unit tests and six Electron end-to-end flows cover the updated behavior, including a protocol fixture exercising a native goal continuation. Visual evidence is in `test-results/` after running the E2E suite. Full manual VoiceOver auditing remains outside these checks.

- The 0.3.0 arm64 `.app` and `.dmg` were built successfully. Launching the packaged executable confirmed version 0.3.0, renderer sandbox enabled, and SQLite-backed snapshot access. `scripts/package-smoke.ts` preserves this smoke check.

## 0.4.0 conversation and panel corrections

- Codex reasoning now accepts both summary and text delta notifications, reads completed summary/content, and does not overwrite previously streamed text with an empty final summary. An empty completed reasoning item displays an explicit unavailable-summary message instead of an empty disclosure.
- Editing a user message opens a textarea in place, with Cancel/Send and read-only attachments. The backend takes attachment IDs from the original persisted message; renderer edit requests cannot replace them. Sending branches at the previous context and immediately submits the edited text, preserving the original conversation and workspace files.
- New Conversation is an unsaved composer until its first send; empty session titles do not appear in navigation. Archiving the selected conversation returns to a fresh, enabled composer. Projects have Delete only; only archived conversations expose Delete, and the backend enforces that rule.
- Both side panels use persistent width transitions with the same spring and inert hidden content. Review resizing remains immediate while dragging. The native titlebar draggable rectangle no longer overlaps the left toggle. System mouse clicks through Computer Use confirmed close and reopen in an isolated Electron instance, in addition to DOM-driven E2E checks.
- Files and skills are inserted as ordinary editable `@path` and `/skill-name` text (quoted for spaces), without separate reference chips. Removing the text removes the corresponding structured send context. Existing chip-style session drafts are converted on load; Plan/Goal remain mode controls.
- Automated checks now include 24 unit cases and seven Electron flows, adding reasoning fallback, archived-only deletion, in-place text editing with immutable attachments, fresh composition after archive, inline context filtering, and review collapse.

## 0.4.1 sidebar refinement

- Project hover and selected conversation share one background token, with a 3 px gap between rows. Project action hover changes only the icon color; its menu trigger and new-conversation button occupy the same continuous row surface.
- The project compose action starts an unsaved conversation in that specific project. Active-list conversation rows expose a direct archive icon; archived conversations retain their restore/delete menu. The project heading uses an aligned plus icon at the caption's font size.
- The seven existing Electron flows passed; an eighth sidebar flow verifies matching hover backgrounds, transparent menu-button hover, row spacing, icon sizing, direct archive access, and sending from the project-specific compose action. The new flow passed after correcting Base UI trigger-slot CSS targeting. Production build/typecheck passed.

## 0.4.2 conversation corrections

- Latest user message editing replaces its turn in the same Moose session, preserving earlier history and original attachments. Older user messages expose copy only; AI replies have no history action.
- Copy aggregates every assistant segment in the run from persisted history, including segments separated by tools or pagination.
- Project menu labels stay on one line. Busy session rows keep their 36px height and show a trailing spinner.
- Codex explicitly requests reasoning summaries with `summary: auto`. A real Homebrew Codex probe with gpt-5.6-luna returned an answer but zero reasoning events; summaries remain dependent on upstream availability.
- Typecheck, 25 unit tests, and 9 Electron end-to-end cases passed (8 full suite plus the new grouped-copy case).
