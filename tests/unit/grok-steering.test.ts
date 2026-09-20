import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { GrokAdapter } from '../../electron/providers/grok';
import { RpcRejected } from '../../electron/providers/rpc';
import type { RunContext } from '../../electron/providers/types';
import type { Session } from '../../shared/types';

it.each(['accepted', 'unsupported', 'disconnect'])(
  'handles Grok steering %s without cancelling or starting another turn',
  async (outcome) => {
    const adapter = new GrokAdapter(resolve('tests/fixtures/grok-steering.mjs'));
    let ready!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const output: string[] = [];
    const context: RunContext = {
      cwd: process.cwd(),
      text: 'start',
      session: { mode: 'ask' } as Session,
      emit(event) {
        if (event.delta) {
          output.push(event.delta);
          if (event.delta === 'Ready') ready();
        }
      },
      nativeId() {},
    };
    const running = adapter.run(context);
    void running.catch(() => {});
    try {
      await started;
      const message = {
        ...context,
        text: outcome === 'accepted' ? 'new direction' : outcome,
        attachments: [
          {
            id: 'image',
            size: 5,
            name: 'image.png',
            path: '/tmp/image.png',
            mime: 'image/png',
            data: 'aGVsbG8=',
          },
        ],
      };
      if (outcome === 'accepted') {
        await expect(
          adapter.steer({
            ...message,
            promptContext: { mode: 'plan', references: [], skills: [] },
          }),
        ).rejects.toBeInstanceOf(RpcRejected);
        expect(await adapter.steer(message)).toBe('');
        await running;
        expect(output).toContain('Steered: new direction [image]');
        await expect(adapter.steer(message)).rejects.toBeInstanceOf(RpcRejected);
      } else if (outcome === 'unsupported') {
        await expect(adapter.steer(message)).rejects.toBeInstanceOf(RpcRejected);
        expect(output).toEqual(['Ready']);
      } else {
        await expect(adapter.steer(message)).rejects.not.toBeInstanceOf(RpcRejected);
      }
    } finally {
      await adapter.close();
      await running.catch(() => {});
    }
  },
);
