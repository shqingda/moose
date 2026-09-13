import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../../electron/db/store';
import { MooseService } from '../../electron/service';
import { Attachments, agentAttachments } from '../../electron/attachments';
import { codexPermissions } from '../../electron/providers/codex';
import { diffLines } from '../../src/lib/diff';
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const run of cleanup.splice(0)) await run(); });
function fixture() { const dir = mkdtempSync(join(tmpdir(), 'moose-history-')); const store = new Store(join(dir, 'db')); const service = new MooseService(store, () => {}); cleanup.push(async () => { await service.close(); rmSync(dir, { recursive: true, force: true }); }); return { dir, store, service }; }
it('preserves original history and produces an editable branch without reverting code', async () => {
  const { dir, store, service } = fixture(), session = store.createSession(store.addProject(dir).id, 'grok');
  writeFileSync(join(dir, 'keep.txt'), 'existing edits');
  const first = store.begin(store.enqueue(session.id, 'first'), randomUUID());
  store.saveMessage({ id: randomUUID(), sessionId: session.id, runId: first.runId, seq: 2, kind: 'assistant', text: 'first result', title: '', state: 'done', createdAt: Date.now() });
  const second = store.begin(store.enqueue(session.id, 'second'), randomUUID());
  const branch = await service.handle('rewind', { sessionId: session.id, messageId: second.id, edit: true }) as typeof session;
  expect(branch.draft).toBe('second'); expect(branch.nativeId).toBeNull(); expect(branch.historySeed).toContain('first result'); expect(branch.historySeed).not.toContain('user: second');
  expect(store.allMessages(branch.id)).toHaveLength(2); expect(store.allMessages(session.id)).toHaveLength(3);
  expect(readFileSync(join(dir, 'keep.txt'), 'utf8')).toBe('existing edits');
});
it('archives all project sessions and deletes only Moose rows', async () => {
  const { dir, store, service } = fixture(), p = store.addProject(dir), a = store.createSession(p.id, 'codex'), b = store.createSession(p.id, 'grok');
  store.enqueue(a.id, 'queued'); store.enqueue(b.id, 'queued'); writeFileSync(join(dir, 'keep.txt'), 'keep');
  await service.handle('archiveProject', { projectId: p.id }); expect(store.listSessions().every(s => s.archived)).toBe(true);
  await service.handle('deleteProject', { projectId: p.id }); expect(store.listSessions()).toEqual([]); expect(store.queued()).toEqual([]); expect(store.listProjects()).toEqual([]); expect(readFileSync(join(dir, 'keep.txt'), 'utf8')).toBe('keep');
});
it('copies attachments, persists drafts and queues, rejects traversal and video', async () => {
  const { dir, store } = fixture(), storage = new Attachments(store.sqlite.name), s = store.createSession(store.addProject(dir).id, 'codex');
  const file = await storage.import('../../文 件.md', Buffer.from('context from file'));
  expect(file.name).toBe('文 件.md'); expect(storage.path(file).startsWith(join(dir, 'attachments'))).toBe(true);
  store.updateSession(s.id, { draftAttachments: [file] }); const item = store.enqueue(s.id, '', [file]); const message = store.begin(item, randomUUID());
  expect(store.session(s.id).title).toBe('文 件.md'); expect(message.attachments).toEqual([file]); expect(store.session(s.id).draftAttachments).toEqual([file]); expect((await agentAttachments(storage, [file]))[0].text).toBe('context from file');
  await expect(storage.get('../../etc/passwd')).rejects.toThrow('Invalid'); await expect(storage.import('clip.mov', Buffer.from('video'))).rejects.toThrow('Video');
});
it('maps permission modes without treating auto-review as full access', () => {
  expect(codexPermissions('ask')).toMatchObject({ approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write' });
  expect(codexPermissions('auto')).toMatchObject({ approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', sandbox: 'workspace-write' });
  expect(codexPermissions('full')).toMatchObject({ approvalPolicy: 'never', sandbox: 'danger-full-access' });
});
it('renders actual old and new line numbers across multiple hunks', () => {
  const lines = diffLines('--- a/a.ts\n+++ b/a.ts\n@@ -20,2 +20,2 @@\n-previous\n+next\n context\n@@ -100 +102 @@\n-old\n+new');
  expect(lines.find(l => l.text === 'previous')).toMatchObject({ old: 20, kind: 'removed' });
  expect(lines.find(l => l.text === 'context')).toMatchObject({ old: 21, next: 21 });
  expect(lines.at(-1)).toMatchObject({ next: 102, kind: 'added' });
});
