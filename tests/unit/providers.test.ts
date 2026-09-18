import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../electron/db/store';
import { MooseService } from '../../electron/service';
import type { AgentAdapter } from '../../electron/providers/types';
import { discover, cliVersion } from '../../electron/providers/process';

vi.mock('../../electron/providers/process', () => ({
  discover: vi.fn(async (_provider: string, path: string) => path),
  cliVersion: vi.fn(async () => 'test version'),
}));

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.clearAllMocks();
});

it.each([true, false])(
  'returns the latest saved configuration to all callers (enabled=%s)',
  async (enabled) => {
    const dir = mkdtempSync(join(tmpdir(), 'moose-providers-'));
    const store = new Store(join(dir, 'db.sqlite'));
    store.setSettings({ codexPath: '/old/codex', grokEnabled: false, piEnabled: false });
    let release = () => {};
    let signalStarted = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const factory = vi.fn((_provider: string, path: string): AgentAdapter => ({
      async probe() {
        if (path === '/old/codex') {
          signalStarted();
          await gate;
        }
        return { models: [], modes: [] };
      },
      async run() {},
      respond() {},
      async cancel() {},
      async close() {
        release();
      },
    }));
    const service = new MooseService(store, () => {}, factory);
    cleanups.push(async () => {
      release();
      await service.close();
      rmSync(dir, { recursive: true, force: true });
    });

    const original = service.providers(true);
    await started;
    await service.handle('settings', { codexPath: '/intermediate/codex' });
    const intermediate = service.providers(true);
    await service.handle('settings', { codexPath: '/latest/codex', codexEnabled: enabled });
    const latest = service.providers(true);
    release();

    for (const result of await Promise.all([original, intermediate, latest])) {
      expect(result.find((info) => info.provider === 'codex')).toMatchObject({
        path: '/latest/codex',
        enabled,
        connected: enabled,
      });
    }
    expect(vi.mocked(discover).mock.calls.filter(([provider]) => provider === 'codex')).toEqual([
      ['codex', '/old/codex'],
      ['codex', '/latest/codex'],
    ]);
    expect(factory.mock.calls.map(([, path]) => path)).toEqual(
      enabled ? ['/old/codex', '/latest/codex'] : ['/old/codex'],
    );
    vi.mocked(cliVersion).mockClear();
    expect((await service.providers()).find((info) => info.provider === 'codex')?.path).toBe(
      '/latest/codex',
    );
    expect(cliVersion).not.toHaveBeenCalled();
  },
);
