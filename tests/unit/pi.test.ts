import { afterEach, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { PiAdapter, piCodec, normalizePi } from '../../electron/providers/pi';
import type { AgentEvent } from '../../electron/providers/types';
import type { Session } from '../../shared/types';
const adapters: PiAdapter[] = [];
afterEach(async () => {
  await Promise.all(adapters.splice(0).map((a) => a.close()));
  vi.unstubAllEnvs();
});
function adapter() {
  const a = new PiAdapter(resolve('tests/fixtures/pi.mjs'));
  adapters.push(a);
  return a;
}
const session: Session = {
  id: 's',
  projectId: 'p',
  provider: 'pi',
  nativeId: null,
  model: 'test/model',
  effort: 'high',
  mode: 'full',
  title: '',
  draft: '',
  archived: false,
  status: 'idle',
  createdAt: 0,
  updatedAt: 0,
};
it('maps Pi envelopes without losing extension response IDs', () => {
  expect(
    piCodec.encode({ method: 'extension_ui_response', params: { id: 'abc', confirmed: false } }),
  ).toEqual({ type: 'extension_ui_response', id: 'abc', confirmed: false });
  expect(
    piCodec.decode({ type: 'response', id: '3', success: false, error: 'No key' }),
  ).toMatchObject({ id: 3, error: { message: 'No key' } });
});
it('uses stable block keys for final snapshots and preserves reasoning', () => {
  const delta = normalizePi(
    {
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hi' },
    },
    1,
  )[0];
  const final = normalizePi(
    {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Hi there' },
          { type: 'thinking', thinking: 'Summary' },
        ],
      },
    },
    1,
  );
  expect(final[0].key).toBe(delta.key);
  expect(final[1].kind).toBe('reasoning');
});
it('discovers actual model capabilities over Pi RPC', async () => {
  expect(await adapter().probe()).toMatchObject({
    models: [{ id: 'test/model', efforts: [{ id: 'off' }, { id: 'high' }] }],
    modes: [{ id: 'ask' }, { id: 'auto' }, { id: 'full' }],
    images: true,
  });
});
it('streams, answers extension approval and resumes native session', async () => {
  const a = adapter(),
    events: AgentEvent[] = [];
  let nativeId = '',
    used = 0;
  await a.run({
    session,
    cwd: process.cwd(),
    text: 'approve',
    nativeId: (id) => {
      nativeId = id;
    },
    usage: (u) => {
      used = u.used;
    },
    emit: (e) => {
      events.push(e);
      if (e.kind === 'approval') a.respond(e.key, 'yes');
    },
  });
  expect(events.some((e) => e.text === 'Pi response')).toBe(true);
  expect(used).toBe(1200);
  await adapter().run({
    session: { ...session, nativeId },
    cwd: process.cwd(),
    text: 'resume',
    nativeId: (id) => expect(id).toBe(nativeId),
    emit: () => {},
  });
});
it('stops a mutating tool in ask mode and cancels a pending turn', async () => {
  const a = adapter();
  await expect(
    a.run({
      session: { ...session, mode: 'ask' },
      cwd: process.cwd(),
      text: 'MUTATE',
      nativeId: () => {},
      emit: () => {},
    }),
  ).rejects.toThrow('mutating tool');
  const running = a.run({
    session,
    cwd: process.cwd(),
    text: 'wait',
    nativeId: () => {
      setTimeout(() => void a.cancel(), 10);
    },
    emit: () => {},
  });
  await running;
});

it('does not send a prompt after cancellation during setup', async () => {
  const a = adapter();
  const events: AgentEvent[] = [];
  const running = a.run({
    session,
    cwd: process.cwd(),
    text: 'must not execute',
    nativeId: () => {},
    emit: (event) => events.push(event),
  });
  await a.cancel();
  await running;
  expect(events).toEqual([]);
});

it('finishes hook-handled prompts without waiting for an agent loop', async () => {
  await adapter().run({ session, cwd: process.cwd(), text: 'handled', nativeId() {}, emit() {} });
});
it('acknowledges steering without a turn ID and clears native input before cancellation', async () => {
  const a = adapter(),
    events: AgentEvent[] = [];
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const context = {
    session,
    cwd: process.cwd(),
    text: 'wait',
    nativeId: ready,
    emit: (event: AgentEvent) => events.push(event),
  };
  const running = a.run(context);
  await started;
  await expect(a.steer({ ...context, text: 'new direction' })).resolves.toBeUndefined();
  await expect(a.steer({ ...context, text: 'reject' })).rejects.toThrow('Steering rejected');
  await expect(a.steer({ ...context, text: 'ambiguous' })).rejects.toThrow('did not confirm');
  await a.cancel();
  await running;
  expect(events.some((event) => event.text?.includes('UNEXPECTED_QUEUED_TURN'))).toBe(false);
  await expect(a.steer({ ...context, text: 'late' })).rejects.toThrow('No active');
});

it('keeps steering unavailable on older CLI versions and rejects direct attempts', async () => {
  vi.stubEnv('MOOSE_TEST_PI_VERSION', 'pi 0.85.1');
  const a = adapter();
  expect(await a.probe()).toMatchObject({
    steering: false,
    taskModes: ['build', 'plan', 'goal'],
  });
  await expect(
    a.steer({ session, cwd: process.cwd(), text: 'unsupported', nativeId() {}, emit() {} }),
  ).rejects.toThrow('does not provide verified');
});
