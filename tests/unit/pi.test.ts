import { afterEach, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { PiAdapter, piCodec, normalizePi } from '../../electron/providers/pi';
import type { AgentEvent } from '../../electron/providers/types';
import type { Session } from '../../shared/types';
const adapters: PiAdapter[] = [];
afterEach(async () => {
  await Promise.all(adapters.splice(0).map((a) => a.close()));
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
    modes: [{ id: 'full' }],
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
it('rejects unsupported permissions and cancels a pending turn', async () => {
  const a = adapter();
  await expect(
    a.run({
      session: { ...session, mode: 'ask' },
      cwd: process.cwd(),
      text: 'x',
      nativeId: () => {},
      emit: () => {},
    }),
  ).rejects.toThrow('Full access');
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
