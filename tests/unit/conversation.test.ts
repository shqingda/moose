// 单元测试：会话编辑、归档与历史一致性。
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
afterEach(async () => {
  for (const run of cleanup.splice(0)) await run();
});
/** 创建独立测试数据与依赖，并登记清理，避免测试间相互污染。 */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'moose-history-'));
  const store = new Store(join(dir, 'db'));
  const service = new MooseService(store, () => {});
  cleanup.push(async () => {
    await service.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, store, service };
}
it('rejects the removed rewind operation', async () => {
  const { service } = fixture();
  await expect(service.handle('rewind', {})).rejects.toThrow('Unknown operation');
});
it('allows deletion only after session archive and keeps code when removing a project', async () => {
  const { dir, store, service } = fixture(),
    p = store.addProject(dir),
    a = store.createSession(p.id, 'codex'),
    b = store.createSession(p.id, 'grok');
  store.enqueue(a.id, 'queued');
  store.enqueue(b.id, 'queued');
  writeFileSync(join(dir, 'keep.txt'), 'keep');
  await expect(service.handle('archiveProject', { projectId: p.id })).rejects.toThrow(
    'Unknown operation',
  );
  await expect(service.handle('deleteSession', { sessionId: a.id })).rejects.toThrow('Archive');
  await service.handle('updateSession', { id: a.id, archived: true });
  await service.handle('deleteSession', { sessionId: a.id });
  expect(store.listSessions()).toHaveLength(1);
  expect(store.queued(a.id)).toHaveLength(0);
  await service.handle('deleteProject', { projectId: p.id });
  expect(store.listSessions()).toEqual([]);
  expect(store.queued()).toEqual([]);
  expect(store.listProjects()).toEqual([]);
  expect(readFileSync(join(dir, 'keep.txt'), 'utf8')).toBe('keep');
});
it('copies attachments, persists drafts and queues, rejects traversal and video', async () => {
  const { dir, store } = fixture(),
    storage = new Attachments(store.sqlite.name),
    s = store.createSession(store.addProject(dir).id, 'codex');
  const file = await storage.import('../../文 件.md', Buffer.from('context from file'));
  expect(file.name).toBe('文 件.md');
  expect(storage.path(file).startsWith(join(dir, 'attachments'))).toBe(true);
  store.updateSession(s.id, { draftAttachments: [file] });
  const item = store.enqueue(s.id, '', [file]);
  const message = store.begin(item, randomUUID());
  expect(store.session(s.id).title).toBe('文 件.md');
  expect(message.attachments).toEqual([file]);
  expect(store.session(s.id).draftAttachments).toEqual([file]);
  expect((await agentAttachments(storage, [file]))[0].text).toBe('context from file');
  await expect(storage.get('../../etc/passwd')).rejects.toThrow('Invalid');
  await expect(storage.import('clip.mov', Buffer.from('video'))).rejects.toThrow('Video');
});
it('maps permission modes without treating auto-review as full access', () => {
  expect(codexPermissions('ask')).toMatchObject({
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandbox: 'workspace-write',
  });
  expect(codexPermissions('auto')).toMatchObject({
    approvalPolicy: 'on-request',
    approvalsReviewer: 'auto_review',
    sandbox: 'workspace-write',
  });
  expect(codexPermissions('full')).toMatchObject({
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
  });
});
it('renders actual old and new line numbers across multiple hunks', () => {
  const lines = diffLines(
    '--- a/a.ts\n+++ b/a.ts\n@@ -20,2 +20,2 @@\n-previous\n+next\n context\n@@ -100 +102 @@\n-old\n+new',
  );
  expect(lines.find((l) => l.text === 'previous')).toMatchObject({ old: 20, kind: 'removed' });
  expect(lines.find((l) => l.text === 'context')).toMatchObject({ old: 21, next: 21 });
  expect(lines.at(-1)).toMatchObject({ next: 102, kind: 'added' });
});

it('replaces the last turn atomically and copies a whole response across tools', async () => {
  const { dir, store, service } = fixture(),
    session = store.createSession(store.addProject(dir).id, 'grok');
  const first = store.begin(store.enqueue(session.id, 'first'), randomUUID());
  for (const [kind, text] of [
    ['assistant', 'Before'],
    ['tool', 'private tool log'],
    ['assistant', 'After'],
  ] as const)
    store.saveMessage({
      id: randomUUID(),
      sessionId: session.id,
      runId: first.runId,
      seq: 1,
      kind,
      text,
      title: '',
      state: 'done',
      createdAt: Date.now(),
    });
  expect(await service.handle('responseText', { sessionId: session.id, runId: first.runId })).toBe(
    'Before\n\nAfter',
  );
  const last = store.begin(store.enqueue(session.id, 'last'), randomUUID());
  await expect(
    service.handle('editMessage', { sessionId: session.id, messageId: first.id, text: 'invalid' }),
  ).rejects.toThrow('latest');
  store.replaceLastTurn(session.id, last.position, null, 'retained history', 'replacement', []);
  expect(store.listSessions()).toHaveLength(1);
  expect(store.allMessages(session.id).map((m) => m.text)).toEqual([
    'first',
    'Before',
    'private tool log',
    'After',
  ]);
  expect(store.queued(session.id)[0].text).toBe('replacement');
});
