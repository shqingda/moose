// 单元测试：执行队列、同目录串行与取消行为。
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MooseService } from '../../electron/service';
import { Store } from '../../electron/db/store';
import type { AgentAdapter, RunContext } from '../../electron/providers/types';
/** 可由测试手动结束的代理替身，用来断言排队、取消和目录互斥。 */
class ControlledAgent implements AgentAdapter {
  context?: RunContext;
  complete: () => void = () => {};
  async probe() {
    return { models: [], modes: [] };
  }
  async run(context: RunContext) {
    this.context = context;
    context.nativeId('native');
    await new Promise<void>((resolve) => {
      this.complete = resolve;
    });
  }
  steer = vi.fn(async (_context: RunContext) => 'native-turn');
  respond() {}
  async cancel() {
    this.complete();
  }
  async close() {
    this.complete();
  }
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
/** 创建独立测试数据与依赖，并登记清理，避免测试间相互污染。 */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'moose-service-')),
    store = new Store(join(dir, 'db.sqlite')),
    agents: ControlledAgent[] = [];
  const service = new MooseService(
    store,
    () => {},
    () => {
      const a = new ControlledAgent();
      agents.push(a);
      return a;
    },
  );
  cleanups.push(async () => {
    await service.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, store, service, agents };
}
it('serializes a shared directory but runs independent projects concurrently', async () => {
  const { dir, store, service, agents } = fixture();
  mkdirSync(`${dir}/other`);
  const p1 = store.addProject(dir),
    p2 = store.addProject(`${dir}/other`);
  const a = store.createSession(p1.id, 'codex'),
    b = store.createSession(p1.id, 'codex'),
    c = store.createSession(p2.id, 'codex');
  await service.handle('send', { sessionId: a.id, text: 'first' });
  await service.handle('send', { sessionId: b.id, text: 'second' });
  await service.handle('send', { sessionId: c.id, text: 'parallel' });
  await vi.waitFor(() => expect(agents.filter((a) => a.context)).toHaveLength(2));
  expect(agents.map((a) => a.context?.text).sort()).toEqual(['first', 'parallel']);
  agents[0].complete();
  await vi.waitFor(() => expect(agents.filter((a) => a.context)).toHaveLength(3));
  expect(agents[2].context?.text).toBe('second');
});
it('expires approvals on cancellation and rejects stale responses and late deltas', async () => {
  const { dir, store, service, agents } = fixture();
  const session = store.createSession(store.addProject(dir).id, 'codex');
  await service.handle('send', { sessionId: session.id, text: 'go' });
  await vi.waitFor(() => expect(agents[0]?.context).toBeDefined());
  agents[0].context!.emit({
    key: 'approve',
    kind: 'approval',
    text: 'Allow?',
    choices: [{ id: 'accept', label: 'Allow' }],
    state: 'pending',
  });
  expect(store.session(session.id).status).toBe('waiting');
  const id = store.page(session.id).messages.find((m) => m.kind === 'approval')!.id;
  await service.stop(session.id);
  agents[0].context!.emit({ key: 'late', kind: 'assistant', text: 'late' });
  expect(store.page(session.id).messages.find((m) => m.id === id)?.state).toBe('expired');
  expect(store.page(session.id).messages.some((m) => m.text === 'late')).toBe(false);
  await expect(
    service.handle('respond', { sessionId: session.id, messageId: id, choice: 'accept' }),
  ).rejects.toThrow('no longer active');
});
it('retains editable queued followups after stop, then resumes on explicit action', async () => {
  const { dir, store, service, agents } = fixture();
  const session = store.createSession(store.addProject(dir).id, 'codex');
  await service.handle('send', { sessionId: session.id, text: 'go' });
  await vi.waitFor(() => expect(agents).toHaveLength(1));
  await service.handle('send', { sessionId: session.id, text: 'later' });
  await service.stop(session.id);
  const item = store.queued(session.id)[0];
  expect(item.text).toBe('later');
  await service.handle('updateQueue', { id: item.id, text: 'edited' });
  await service.handle('resumeQueue', { sessionId: session.id });
  await vi.waitFor(() => expect(agents.filter((a) => a.context)).toHaveLength(2));
  expect(agents[1].context?.text).toBe('edited');
});

it('pauses queued followups after planning and blocks approval until the run is finished', async () => {
  const { dir, store, service, agents } = fixture();
  const session = store.createSession(store.addProject(dir).id, 'codex');
  await service.handle('send', {
    sessionId: session.id,
    text: 'plan',
    context: { mode: 'plan', references: [], skills: [] },
  });
  await vi.waitFor(() => expect(agents[0]?.context).toBeDefined());
  agents[0].context!.emit({
    key: 'plan',
    kind: 'plan',
    text: 'Review before execution',
    state: 'done',
  });
  await vi.waitFor(() =>
    expect(store.allMessages(session.id).some((m) => m.kind === 'plan')).toBe(true),
  );
  const plan = store.allMessages(session.id).find((m) => m.kind === 'plan')!;
  const args = { sessionId: session.id, messageId: plan.id, version: 1 };
  await expect(service.handle('approvePlan', args)).rejects.toThrow('Wait for project tasks');
  await service.handle('send', { sessionId: session.id, text: 'must remain queued' });
  agents[0].complete();
  await vi.waitFor(() => expect(store.session(session.id).status).toBe('completed'));
  expect(store.queued(session.id)).toHaveLength(1);
  expect(agents).toHaveLength(1);
  await expect(service.handle('approvePlan', args)).rejects.toThrow('queued messages');
  store.updateQueue(store.queued(session.id)[0].id, undefined, true);
  await service.handle('approvePlan', args);
  await vi.waitFor(() => expect(agents[1]?.context?.promptContext?.mode).toBe('build'));
  expect(agents[1].context?.text).toContain('Review before execution');
});
it('expires a plan when its run is cancelled even if its item was already completed', async () => {
  const { dir, store, service, agents } = fixture();
  const session = store.createSession(store.addProject(dir).id, 'codex');
  await service.handle('send', {
    sessionId: session.id,
    text: 'plan',
    context: { mode: 'plan', references: [], skills: [] },
  });
  await vi.waitFor(() => expect(agents[0]?.context).toBeDefined());
  agents[0].context!.emit({ key: 'plan', kind: 'plan', text: 'Incomplete run', state: 'done' });
  await service.stop(session.id);
  const plan = store.allMessages(session.id).find((m) => m.kind === 'plan')!;
  expect(plan.state).toBe('expired');
  await expect(
    service.handle('approvePlan', { sessionId: session.id, messageId: plan.id, version: 1 }),
  ).rejects.toThrow('not ready');
});
it('persists steering separately from queue and rejects it after stopping', async () => {
  const { dir, store, service, agents } = fixture();
  const session = store.createSession(store.addProject(dir).id, 'codex');
  await service.handle('send', { sessionId: session.id, text: 'original' });
  await vi.waitFor(() => expect(agents[0]?.context).toBeDefined());
  const requestId = crypto.randomUUID();
  await service.handle('steer', { sessionId: session.id, requestId, text: 'new direction' });
  expect(store.message(requestId)?.delivery?.status).toBe('accepted');
  expect(store.queued(session.id)).toHaveLength(0);
  expect(agents[0].steer).toHaveBeenCalledTimes(1);
  await service.stop(session.id);
  await service.handle('steer', { sessionId: session.id, requestId, text: 'new direction' });
  expect(agents[0].steer).toHaveBeenCalledTimes(1);
  await expect(
    service.handle('steer', {
      sessionId: session.id,
      requestId: crypto.randomUUID(),
      text: 'too late',
    }),
  ).rejects.toThrow('No active turn');
});
it('holds queued agents during user configuration writes and rejects writes during a run', async () => {
  const { dir, store, service, agents } = fixture();
  const { resolve } = await import('node:path');
  const { randomUUID } = await import('node:crypto');
  store.setSettings({ codexPath: resolve('tests/fixtures/extensions.mjs') });
  const project = store.addProject(dir),
    session = store.createSession(project.id, 'codex');
  const scope = { projectId: project.id, sessionId: session.id, provider: 'codex' };
  const snapshot = (await service.handle(
    'extensionsRead',
    scope,
  )) as import('../../shared/extensions').ExtensionSnapshot;
  const args = {
    ...scope,
    requestId: randomUUID(),
    change: {
      type: 'config',
      sourceId: snapshot.sources[0].id,
      version: snapshot.sources[0].version,
      key: 'model',
      value: 'new-model',
    },
  };
  const writing = service.handle('extensionsChange', args);
  await service.handle('send', { sessionId: session.id, text: 'queued during configuration' });
  expect(agents).toHaveLength(0);
  await writing;
  await vi.waitFor(() => expect(agents[0]?.context).toBeDefined());
  await expect(
    service.handle('extensionsChange', { ...args, requestId: randomUUID() }),
  ).rejects.toThrow('Wait');
  agents[0].complete();
});
it('dispatches scheduled agent messages through the normal queue and records their completion', async () => {
  const { dir, store, service, agents } = fixture();
  const { resolve } = await import('node:path');
  const { randomUUID } = await import('node:crypto');
  store.setSettings({ codexPath: resolve('tests/fixtures/agent.mjs') });
  const project = store.addProject(dir),
    session = store.createSession(project.id, 'codex'),
    scope = { projectId: project.id, sessionId: session.id };
  const args = {
    ...scope,
    requestId: randomUUID(),
    name: 'Inspect',
    task: { kind: 'agent', text: 'scheduled inspection' },
    timezone: 'Asia/Shanghai',
    startAt: Date.now() + 100,
    intervalMs: null,
  };
  await service.handle('scheduleCreate', args);
  await vi.waitFor(() => expect(agents[0]?.context?.text).toBe('scheduled inspection'), {
    timeout: 4000,
  });
  expect(agents[0].context?.promptContext?.mode).toBe('build');
  agents[0].complete();
  await vi.waitFor(async () =>
    expect(
      (
        (await service.handle(
          'scheduleList',
          scope,
        )) as import('../../shared/background').Schedule[]
      )[0].last?.status,
    ).toBe('completed'),
  );
  await service.handle('scheduleCreate', args);
  expect(agents).toHaveLength(1);
});
