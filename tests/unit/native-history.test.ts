import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { NativeHistory } from '../../electron/native-history';
import { Store } from '../../electron/db/store';
import type { NativeSessions } from '../../electron/providers/native-types';
import type { AgentAdapter } from '../../electron/providers/types';
import type { NativeThread } from '../../shared/native-sessions';
import type { Session } from '../../shared/types';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
function fixture() {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'moose-history-'))),
    store = new Store(join(cwd, 'db'));
  const project = store.addProject(cwd),
    session = store.createSession(project.id, 'codex');
  store.updateSession(session.id, { nativeId: 'root' });
  const thread: NativeThread = {
    id: 'external',
    title: 'External history',
    cwd,
    parentId: null,
    forkedFromId: null,
    status: 'idle',
    model: 'fixture',
    effort: '',
    canAcceptInput: true,
    updatedAt: 0,
  };
  const native: NativeSessions = {
    capabilities: async () => ({ history: true, fork: true, compact: true, children: true }),
    list: async () => ({ data: [thread], nextCursor: null }),
    read: async (id) => ({ ...thread, id }),
    items: vi.fn(async (_id, _cwd, cursor) => ({
      data: [
        {
          id: cursor || 'first',
          turnId: 'turn-1',
          kind: 'user' as const,
          title: '',
          text: cursor ? 'Second page' : 'First page',
        },
      ],
      nextCursor: cursor ? null : 'next',
    })),
    fork: vi.fn(async () => ({ ...thread, id: 'forked', forkedFromId: 'root' })),
    compact: vi.fn(async () => {}),
    control: vi.fn(async () => {}),
  };
  const adapter: AgentAdapter = {
    sessions: native,
    probe: async () => ({ models: [], modes: [] }),
    run: async () => {},
    respond() {},
    cancel: async () => {},
    close: async () => {},
  };
  let locked = false,
    active = false;
  const history = new NativeHistory(store, {
    adapter: async () => adapter,
    active: () => (active ? adapter : undefined),
    changed() {},
    lock: () => {
      if (locked) throw new Error('locked');
      locked = true;
      return () => {
        locked = false;
      };
    },
  });
  cleanups.push(async () => {
    await history.close();
    store.close();
    rmSync(cwd, { recursive: true, force: true });
  });
  return {
    store,
    project,
    session,
    thread,
    native,
    history,
    setActive: () => {
      active = true;
    },
    locked: () => locked,
  };
}
it('imports all pages atomically, deduplicates and preserves native checkpoints', async () => {
  const f = fixture(),
    args = { projectId: f.project.id, provider: 'codex', nativeId: 'external' };
  const session = (await f.history.handle('nativeImport', args)) as Session;
  expect(((await f.history.handle('nativeImport', args)) as Session).id).toBe(session.id);
  expect(f.store.allMessages(session.id).map((m) => m.text)).toEqual(['First page', 'Second page']);
  expect(f.store.allMessages(session.id)[0].nativeTurnId).toBe('turn-1');
  expect(session.nativeOrigin?.kind).toBe('import');
  expect(f.native.items).toHaveBeenCalledTimes(2);
});
it('rejects wrong-project sessions and aborts partial imports on pagination failure', async () => {
  const f = fixture(),
    args = { projectId: f.project.id, provider: 'codex', nativeId: 'external' };
  f.thread.cwd = '/';
  await expect(f.history.handle('nativeImport', args)).rejects.toThrow('different project');
  f.thread.cwd = f.project.path;
  f.native.items = async () => ({ data: [], nextCursor: 'loop' });
  await expect(f.history.handle('nativeImport', args)).rejects.toThrow('cursor');
  expect(f.store.listSessions()).toHaveLength(1);
  expect(f.locked()).toBe(false);
});
it('forks once, records lineage and keeps the original native session independent', async () => {
  const f = fixture();
  const item = f.store.enqueue(f.session.id, 'Original');
  f.store.begin(item, 'run');
  f.store.setTurnId('run', 'turn-1');
  f.store.updateSession(f.session.id, { status: 'completed' });
  const args = { sessionId: f.session.id, turnId: 'turn-1', requestId: randomUUID() };
  const fork = (await f.history.handle('nativeFork', args)) as Session;
  expect(fork.nativeOrigin).toMatchObject({
    kind: 'fork',
    sourceNativeId: 'root',
    sourceSessionId: f.session.id,
    forkTurnId: 'turn-1',
  });
  expect(f.store.session(f.session.id).nativeId).toBe('root');
  expect(((await f.history.handle('nativeFork', args)) as Session).id).toBe(fork.id);
  expect(f.native.fork).toHaveBeenCalledTimes(1);
});
it('holds the project lock until compaction completes and never retries uncertain results', async () => {
  const f = fixture();
  let finish!: () => void;
  f.native.compact = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const args = { sessionId: f.session.id, requestId: randomUUID() };
  const pending = f.history.handle('nativeCompact', args);
  await vi.waitFor(() => expect(f.native.compact).toHaveBeenCalled());
  expect(f.locked()).toBe(true);
  expect(f.store.message(args.requestId)?.state).toBe('running');
  await expect(f.history.handle('nativeCompact', args)).rejects.toThrow('already submitted');
  finish();
  await pending;
  expect(f.locked()).toBe(false);
  expect(f.store.message(args.requestId)?.state).toBe('done');
  f.native.compact = vi.fn(async () => {
    throw new Error('disconnected');
  });
  const failed = { ...args, requestId: randomUUID() };
  await expect(f.history.handle('nativeCompact', failed)).rejects.toThrow('disconnected');
  await expect(f.history.handle('nativeCompact', failed)).rejects.toThrow('disconnected');
  expect(f.native.compact).toHaveBeenCalledTimes(1);
});
it('refuses unknown children and checks native ancestry before allowing active-parent controls', async () => {
  const f = fixture();
  const args = {
    sessionId: f.session.id,
    nativeId: 'child',
    action: 'stop',
    requestId: randomUUID(),
  };
  await expect(f.history.handle('childControl', args)).rejects.toThrow('Unknown child');
  f.store.saveMessage({
    id: 'delegation',
    runId: 'run',
    sessionId: f.session.id,
    seq: 1,
    kind: 'tool',
    state: 'done',
    text: '',
    title: '',
    createdAt: 0,
    delegation: { operation: 'spawn', agents: [{ id: 'child', status: 'running', message: '' }] },
  });
  await expect(f.history.handle('childControl', args)).rejects.toThrow('active parent');
  f.setActive();
  await expect(f.history.handle('childControl', args)).rejects.toThrow('parent does not match');
  f.native.read = async (id) => ({ ...f.thread, id, parentId: 'root' });
  await f.history.handle('childControl', args);
  expect(f.native.control).toHaveBeenCalledTimes(1);
  expect(f.history.children(f.session.id)[0].status).toBe('running');
});
it('does not overwrite an existing message when a mutation request ID collides', async () => {
  const f = fixture();
  const original = f.store.begin(f.store.enqueue(f.session.id, 'Keep original'), randomUUID());
  await expect(
    f.history.handle('nativeCompact', { sessionId: f.session.id, requestId: original.id }),
  ).rejects.toThrow('already used');
  expect(f.store.message(original.id)?.text).toBe('Keep original');
  expect(f.native.compact).not.toHaveBeenCalled();
});
it('marks persisted unfinished operations unknown on restart without replaying them', async () => {
  const f = fixture(),
    id = randomUUID();
  const args = { sessionId: f.session.id, requestId: id };
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ method: 'nativeCompact', ...args }))
    .digest('hex');
  f.store.sqlite
    .prepare('INSERT INTO settings(key,value) VALUES (?,?)')
    .run(
      `native-operation:${id}`,
      JSON.stringify({ sessionId: f.session.id, fingerprint, status: 'running' }),
    );
  f.store.saveMessage({
    id,
    runId: id,
    sessionId: f.session.id,
    seq: 1,
    kind: 'notice',
    state: 'running',
    text: 'Compacting…',
    title: '',
    createdAt: 0,
  });
  const restarted = new NativeHistory(f.store, {
    adapter: async () => {
      throw new Error('Must not run');
    },
    active: () => undefined,
    changed() {},
    lock: () => () => {},
  });
  expect(f.store.message(id)).toMatchObject({
    state: 'error',
    text: expect.stringContaining('Result unknown'),
  });
  await expect(restarted.handle('nativeCompact', args)).rejects.toThrow('Result unknown');
  await restarted.close();
});
it('removes operation receipts with a deleted session or project', async () => {
  for (const removeProject of [false, true]) {
    const f = fixture();
    await f.history.handle('nativeCompact', { sessionId: f.session.id, requestId: randomUUID() });
    expect(
      f.store.sqlite
        .prepare("SELECT count(*) AS count FROM settings WHERE key LIKE 'native-operation:%'")
        .get(),
    ).toEqual({ count: 1 });
    if (removeProject) f.store.deleteProject(f.project.id);
    else {
      f.store.updateSession(f.session.id, { archived: true });
      f.store.deleteSession(f.session.id);
    }
    expect(
      f.store.sqlite
        .prepare("SELECT count(*) AS count FROM settings WHERE key LIKE 'native-operation:%'")
        .get(),
    ).toEqual({ count: 0 });
  }
});
