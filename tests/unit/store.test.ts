// 单元测试：数据库迁移、持久化与恢复。
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../../electron/db/store';
import type { Message } from '../../shared/types';
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
/** 创建独立测试数据与依赖，并登记清理，避免测试间相互污染。 */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'moose-store-'));
  dirs.push(dir);
  const file = join(dir, 'moose.sqlite');
  const store = new Store(file);
  const project = store.addProject(dir);
  const session = store.createSession(project.id, 'codex');
  return { store, session, file };
}
describe('durable workspace', () => {
  it('migrates once, retains data, interrupts runs, and never replays saved queues on startup', () => {
    const { store, session, file } = fixture();
    store.enqueue(session.id, 'Keep me queued');
    store.updateSession(session.id, {
      nativeId: 'native-thread',
      status: 'running',
      draft: 'unfinished',
    });
    store.close();
    const restored = new Store(file);
    expect(restored.session(session.id)).toMatchObject({
      nativeId: 'native-thread',
      status: 'interrupted',
      draft: 'unfinished',
    });
    expect(restored.queued()).toHaveLength(1);
    expect(restored.sqlite.pragma('user_version', { simple: true })).toBe(5);
    restored.close();
  });
  it('deduplicates by id and sequence and paginates without losing ordering', () => {
    const { store, session } = fixture();
    const runId = randomUUID();
    const base: Omit<Message, 'position'> = {
      id: randomUUID(),
      runId,
      sessionId: session.id,
      seq: 2,
      kind: 'assistant',
      state: 'done',
      text: 'new',
      title: '',
      createdAt: Date.now(),
    };
    store.saveMessage(base);
    store.saveMessage({ ...base, seq: 1, text: 'stale' });
    expect(store.page(session.id).messages[0].text).toBe('new');
    for (let i = 0; i < 100; i++)
      store.saveMessage({ ...base, id: randomUUID(), seq: i + 3, text: String(i) });
    const latest = store.page(session.id),
      earlier = store.page(session.id, latest.messages[0].position);
    expect(latest.messages).toHaveLength(80);
    expect(latest.hasMore).toBe(true);
    expect(earlier.messages).toHaveLength(21);
    expect(earlier.hasMore).toBe(false);
    expect(earlier.messages.at(-1)!.position).toBeLessThan(latest.messages[0].position);
    store.close();
  });
  it('atomically moves a queued message into an execution', () => {
    const { store, session } = fixture();
    const item = store.enqueue(session.id, 'Implement this');
    store.begin(item, randomUUID());
    expect(store.queued()).toHaveLength(0);
    expect(store.session(session.id).status).toBe('running');
    expect(store.page(session.id).messages[0].text).toBe('Implement this');
    store.close();
  });
});
it('upgrades a version-one database without losing existing conversation data', () => {
  const { store, session, file } = fixture();
  store.updateSession(session.id, { title: 'Existing history', draft: 'existing draft' });
  store.enqueue(session.id, 'existing queue');
  store.sqlite.exec(
    'ALTER TABLE sessions DROP COLUMN native_origin; ALTER TABLE sessions DROP COLUMN worktree_id; DROP TABLE worktrees; ALTER TABLE sessions DROP COLUMN draft_context; ALTER TABLE queue DROP COLUMN context; ALTER TABLE sessions DROP COLUMN draft_attachments; ALTER TABLE sessions DROP COLUMN history_seed; ALTER TABLE queue DROP COLUMN attachments; PRAGMA user_version = 1;',
  );
  store.close();
  const upgraded = new Store(file);
  expect(upgraded.session(session.id)).toMatchObject({
    title: 'Existing history',
    draft: 'existing draft',
    draftAttachments: [],
    historySeed: '',
  });
  expect(upgraded.queued()[0]).toMatchObject({ text: 'existing queue', attachments: [] });
  upgraded.close();
});
