import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { OpenCodeAdapter } from '../../electron/providers/opencode';
import type { RunContext, AgentEvent } from '../../electron/providers/types';
import type { Session } from '../../shared/types';
const path = resolve('tests/fixtures/opencode.mjs');
function context(emit: (event: AgentEvent) => void, overrides: Partial<Session> = {}): RunContext {
  return {
    cwd: process.cwd(),
    text: 'hello',
    session: {
      nativeId: 'saved-session',
      mode: 'ask',
      model: 'fixture/model',
      ...overrides,
    } as Session,
    emit,
    nativeId: () => {},
  };
}
it('discovers v2 ACP models and permissions, suppresses history, and settles only after prompt completion', async () => {
  const adapter = new OpenCodeAdapter(path);
  try {
    expect(await adapter.probe()).toMatchObject({
      models: [{ id: 'fixture/model' }],
      modes: [{ id: 'ask' }],
      images: true,
    });
    const events: AgentEvent[] = [];
    await adapter.run(
      context((event) => {
        events.push(event);
        if (event.kind === 'approval') {
          expect(() => adapter.respond(event.key, 'invalid')).toThrow();
          adapter.respond(event.key, 'allow');
        }
      }),
    );
    expect(events.some((event) => event.delta === 'HISTORICAL_REPLAY')).toBe(false);
    expect(events.at(-1)?.delta).toBe('OpenCode fixture completed');
    expect(() => adapter.respond('permission:permission', 'allow')).toThrow();
  } finally {
    await adapter.close();
  }
});
it('supports denial and rejects unsupported permission modes', async () => {
  const adapter = new OpenCodeAdapter(path);
  try {
    await expect(adapter.run(context(() => {}, { mode: 'full' }))).rejects.toThrow(
      'Request approval',
    );
    const events: AgentEvent[] = [];
    await adapter.run(
      context((event) => {
        events.push(event);
        if (event.kind === 'approval') adapter.respond(event.key, 'deny');
      }),
    );
    expect(events.at(-1)?.delta).toBe('OpenCode fixture denied');
  } finally {
    await adapter.close();
  }
});
it('cancels a live prompt without retrying it', async () => {
  const adapter = new OpenCodeAdapter(path);
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const run = adapter
    .run({ ...context(() => {}), text: 'hold', nativeId: started })
    .catch((error) => error);
  await ready;
  await adapter.cancel();
  await run;
});

it('rejects a non-v2 executable before starting ACP', async () => {
  const adapter = new OpenCodeAdapter(resolve('tests/fixtures/agent.mjs'));
  try {
    await expect(adapter.probe()).rejects.toThrow('v2 is required');
  } finally {
    await adapter.close();
  }
});
