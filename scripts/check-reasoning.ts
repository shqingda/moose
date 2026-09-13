import { CodexAdapter } from '../electron/providers/codex';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '../shared/types';
const cwd = await mkdtemp(join(tmpdir(), 'moose-summary-'));
const adapter = new CodexAdapter('/opt/homebrew/bin/codex');
const session: Session = { id: 'probe', projectId: 'probe', provider: 'codex', title: '', nativeId: null, archived: false, model: 'gpt-5.6-luna', effort: 'medium', mode: 'ask', draft: '', status: 'idle', createdAt: Date.now(), updatedAt: Date.now() };
let summaryEvents = 0, summaryCharacters = 0, answer = false;
const timeout = setTimeout(() => void adapter.cancel(), 60000);
try {
 await adapter.run({ session, cwd, text: 'Explain briefly why a queue that serializes writes per project must release its lock after errors. No tools or file changes.', nativeId: () => {}, emit: e => { if (e.kind === 'reasoning') { summaryEvents++; summaryCharacters += (e.text || e.delta || '').length; } if (e.kind === 'assistant' && (e.text || e.delta)) answer = true; } });
 console.log(JSON.stringify({ model: session.model, summary: 'auto', summaryEvents, summaryCharacters, answer }));
} finally { clearTimeout(timeout); await adapter.close(); await rm(cwd, { recursive: true, force: true }); }
