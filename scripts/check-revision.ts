import { CodexAdapter } from '../electron/providers/codex';
import { discover } from '../electron/providers/process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Session } from '../shared/types';
// Explicit live smoke: small real model calls, isolated directory, no existing project edits.
const cwd = await mkdtemp(join(tmpdir(), 'moose-revision-live-'));
const path = await discover('codex', '');
let turnId = '';
const s: Session = { id: randomUUID(), projectId: randomUUID(), provider: 'codex', title: '', nativeId: null, archived: false, model: 'gpt-5.6-luna', effort: 'low', mode: 'ask', draft: '', status: 'idle', createdAt: Date.now(), updatedAt: Date.now() };
const imagePath = resolve('build/icon.iconset/icon_32x32.png');
const bytes = await readFile(imagePath);
let agent = new CodexAdapter(path), answer = '';
try {
 await agent.run({ session: s, cwd, text: 'Read the attached image and text. Briefly name the animal icon in the image and repeat the code from the text. Do not use tools or edit files.', attachments: [{ id: randomUUID(), name: 'icon.png', path: imagePath, mime: 'image/png', size: bytes.length, data: bytes.toString('base64') }, { id: randomUUID(), name: 'note.txt', path: join(cwd, 'note.txt'), mime: 'text/plain', size: 20, text: 'Code: MOOSE_CHECKPOINT_427' }], nativeId: id => { s.nativeId = id; }, turnId: id => { turnId = id; }, emit: event => { if (event.kind === 'assistant') answer = event.text ?? answer + (event.delta || ''); } });
 console.log(JSON.stringify({ stage: 'image-and-text', answer, nativeTurn: !!turnId }));
 if (!answer.includes('MOOSE_CHECKPOINT_427') || !turnId) throw new Error('Live attachment check failed');
 await agent.close(); agent = new CodexAdapter(path);
 s.nativeId = await agent.fork(s, cwd, turnId); await agent.close(); agent = new CodexAdapter(path); answer = '';
 await agent.run({ session: s, cwd, text: 'What exact code did I attach before? Reply with only that code. Do not use tools.', nativeId: id => { s.nativeId = id; }, emit: event => { if (event.kind === 'assistant') answer = event.text ?? answer + (event.delta || ''); } });
 console.log(JSON.stringify({ stage: 'native-fork-resume', answer }));
 if (!answer.includes('MOOSE_CHECKPOINT_427')) throw new Error('Checkpoint continuation lost context');
} finally { await agent.close(); }
