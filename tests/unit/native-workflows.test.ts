import { CodexAdapter } from '../../electron/providers/codex';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../../electron/db/store';
import { Plans } from '../../electron/plans';
import { Steering } from '../../electron/steering';
import { RpcRejected } from '../../electron/providers/rpc';
import { codexInput } from '../../electron/providers/codex-input';

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'moose-native-'));
  const store = new Store(join(dir, 'db'));
  cleanup.push(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const session = store.createSession(store.addProject(dir).id, 'codex');
  const runId = randomUUID();
  store.begin(store.enqueue(session.id, 'Make a plan'), runId);
  const plan = store.saveMessage({
    id: randomUUID(),
    runId,
    sessionId: session.id,
    kind: 'plan',
    seq: 2,
    state: 'done',
    title: 'Plan',
    text: 'Original scope',
    plan: { version: 1 },
    createdAt: Date.now(),
  });
  return { dir, store, session, runId, plan };
}
it('binds approval to the edited version and atomically enqueues it once', () => {
  const { store, session, plan } = fixture();
  const plans = new Plans(store);
  const args = { sessionId: session.id, messageId: plan.id, version: 1 };
  const edited = plans.edit({ ...args, text: 'Only the edited scope' });
  expect(edited.plan?.version).toBe(2);
  expect(() => plans.approve(args)).toThrow('changed');
  const queued = plans.approve({ ...args, version: 2 });
  expect(queued.text).toContain('Only the edited scope');
  expect(queued.text).not.toContain('Original scope');
  expect(queued.context?.mode).toBe('build');
  expect(() => plans.approve({ ...args, version: 2 })).toThrow('already been approved');
  expect(store.queued(session.id)).toHaveLength(1);
  expect(store.message(plan.id)?.plan?.queueId).toBe(queued.id);
});
it('rejects obsolete plans and leaves review intact when another message is queued', () => {
  const { store, session, plan } = fixture();
  const plans = new Plans(store);
  const args = { sessionId: session.id, messageId: plan.id, version: 1 };
  const queue = store.enqueue(session.id, 'next');
  expect(() => plans.approve(args)).toThrow('queued messages');
  expect(store.message(plan.id)?.plan?.queueId).toBeUndefined();
  store.begin(queue, randomUUID());
  expect(() => plans.approve(args)).toThrow('newer conversation');
});
it.each(['accepted', 'rejected', 'unknown'] as const)(
  'persists %s steering and never retries the same request ID',
  async (status) => {
    const { store, session, runId } = fixture();
    const steer = new Steering(store, () => {});
    const args = { sessionId: session.id, requestId: randomUUID(), text: 'New direction' };
    const deliver = vi.fn(async () => {
      if (status === 'rejected') throw new RpcRejected('Turn ended');
      if (status === 'unknown') throw new Error('Connection lost');
      return 'turn-1';
    });
    const rows = await Promise.all([
      steer.send(args, runId, [], deliver),
      steer.send(args, runId, [], deliver),
    ]);
    expect(rows[0].delivery?.status).toBe(status);
    expect(rows[1]).toEqual(rows[0]);
    expect(deliver).toHaveBeenCalledTimes(1);
    const restored = new Steering(store, () => {});
    expect((await restored.send(args, runId, [], deliver)).delivery?.status).toBe(status);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(store.queued(session.id)).toHaveLength(0);
  },
);
it('does not resend a persisted in-flight steering request after a restart', async () => {
  const { store, session, runId } = fixture();
  const args = { sessionId: session.id, requestId: randomUUID(), text: 'Unconfirmed' };
  store.saveMessage({
    id: args.requestId,
    sessionId: session.id,
    runId,
    seq: 1,
    kind: 'user',
    text: args.text,
    title: '',
    state: 'expired',
    delivery: { status: 'sending' },
    createdAt: Date.now(),
  });
  const deliver = vi.fn(async () => 'turn');
  const row = await new Steering(store, () => {}).send(args, runId, [], deliver);
  expect(row.state).toBe('expired');
  expect(deliver).not.toHaveBeenCalled();
});
it('uses native references, skills and attachments for steering input', () => {
  const { session, dir } = fixture();
  const input = codexInput({
    session,
    cwd: dir,
    text: 'Adjust scope',
    nativeId: () => {},
    emit: () => {},
    selection: {
      references: [
        {
          id: 'file',
          name: 'file',
          path: '/tmp/file',
          kind: 'file',
          scope: 'project',
          description: '',
        },
      ],
      skills: [],
    },
    attachments: [
      { id: randomUUID(), name: 'photo.png', path: '/tmp/photo.png', mime: 'image/png', size: 12 },
    ],
  });
  expect(input).toContainEqual({ type: 'mention', name: 'file', path: '/tmp/file' });
  expect(input).toContainEqual({ type: 'localImage', path: '/tmp/photo.png' });
});

it('can steer when turn/start responds before turn/started notification', async () => {
  const { session, dir } = fixture();
  const adapter = new CodexAdapter(resolve('tests/fixtures/agent.mjs'));
  let steering: Promise<string> | undefined;
  const context = {
    session,
    cwd: dir,
    text: 'steer-response-first',
    nativeId: () => {},
    emit: () => {},
    turnId: () => {
      steering ||= adapter.steer({ ...context, text: 'Updated direction' });
      void steering.catch(() => {});
    },
  };
  try {
    await adapter.run(context);
    expect(await steering).toBeTruthy();
    await expect(adapter.steer({ ...context, text: 'Too late' })).rejects.toThrow('ended');
  } finally {
    await adapter.close();
  }
});
