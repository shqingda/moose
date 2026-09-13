import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MooseService } from '../../electron/service';
import { Store } from '../../electron/db/store';
import type { AgentAdapter, RunContext } from '../../electron/providers/types';
class ControlledAgent implements AgentAdapter {
  context?: RunContext;
  complete: () => void = () => {};
  async probe() { return { models: [], modes: [] }; }
  async run(context: RunContext) { this.context = context; context.nativeId('native'); await new Promise<void>(resolve => { this.complete = resolve; }); }
  respond() {}
  async cancel() { this.complete(); }
  async close() { this.complete(); }
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'moose-service-')), store = new Store(join(dir, 'db.sqlite')), agents: ControlledAgent[] = [];
  const service = new MooseService(store, () => {}, () => { const a = new ControlledAgent(); agents.push(a); return a; });
  cleanups.push(async () => { await service.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, store, service, agents };
}
it('serializes a shared directory but runs independent projects concurrently', async () => {
  const { dir, store, service, agents } = fixture();
  mkdirSync(`${dir}/other`);
  const p1 = store.addProject(dir), p2 = store.addProject(`${dir}/other`);
  const a = store.createSession(p1.id, 'codex'), b = store.createSession(p1.id, 'codex'), c = store.createSession(p2.id, 'codex');
  await service.handle('send', { sessionId: a.id, text: 'first' });
  await service.handle('send', { sessionId: b.id, text: 'second' });
  await service.handle('send', { sessionId: c.id, text: 'parallel' });
  await vi.waitFor(() => expect(agents.filter(a => a.context)).toHaveLength(2));
  expect(agents.map(a => a.context?.text).sort()).toEqual(['first', 'parallel']);
  agents[0].complete(); await vi.waitFor(() => expect(agents.filter(a => a.context)).toHaveLength(3)); expect(agents[2].context?.text).toBe('second');
});
it('expires approvals on cancellation and rejects stale responses and late deltas', async () => {
  const { dir, store, service, agents } = fixture(); const session = store.createSession(store.addProject(dir).id, 'codex');
  await service.handle('send', { sessionId: session.id, text: 'go' }); await vi.waitFor(() => expect(agents[0]?.context).toBeDefined());
  agents[0].context!.emit({ key: 'approve', kind: 'approval', text: 'Allow?', choices: [{ id: 'accept', label: 'Allow' }], state: 'pending' });
  expect(store.session(session.id).status).toBe('waiting');
  const id = store.page(session.id).messages.find(m => m.kind === 'approval')!.id;
  await service.stop(session.id); agents[0].context!.emit({ key: 'late', kind: 'assistant', text: 'late' });
  expect(store.page(session.id).messages.find(m => m.id === id)?.state).toBe('expired');
  expect(store.page(session.id).messages.some(m => m.text === 'late')).toBe(false);
  await expect(service.handle('respond', { sessionId: session.id, messageId: id, choice: 'accept' })).rejects.toThrow('no longer active');
});
it('retains editable queued followups after stop, then resumes on explicit action', async () => {
  const { dir, store, service, agents } = fixture(); const session = store.createSession(store.addProject(dir).id, 'codex');
  await service.handle('send', { sessionId: session.id, text: 'go' }); await vi.waitFor(() => expect(agents).toHaveLength(1));
  await service.handle('send', { sessionId: session.id, text: 'later' }); await service.stop(session.id);
  const item = store.queued(session.id)[0]; expect(item.text).toBe('later');
  await service.handle('updateQueue', { id: item.id, text: 'edited' }); await service.handle('resumeQueue', { sessionId: session.id });
  await vi.waitFor(() => expect(agents.filter(a => a.context)).toHaveLength(2)); expect(agents[1].context?.text).toBe('edited');
});
