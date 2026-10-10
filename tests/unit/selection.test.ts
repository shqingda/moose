import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../electron/db/store';
import { MooseService } from '../../electron/service';
import {
  defaultSelection,
  readSelection,
  reconcileSelection,
  type ComposerSelection,
} from '../../shared/selection';
import type { ProviderInfo } from '../../shared/types';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function info(partial: Partial<ProviderInfo> & Pick<ProviderInfo, 'provider'>): ProviderInfo {
  return {
    path: '/usr/bin/true',
    version: '1',
    available: true,
    connected: true,
    models: [],
    modes: [
      { id: 'ask', label: 'Request approval' },
      { id: 'auto', label: 'Approve for me' },
      { id: 'full', label: 'Full access' },
    ],
    taskModes: ['build', 'plan', 'goal'],
    ...partial,
  };
}

const remembered: ComposerSelection = {
  provider: 'codex',
  model: 'gpt-5.6',
  effort: 'high',
  mode: 'auto',
  taskMode: 'plan',
};

it('keeps a remembered selection until provider results exist', () => {
  expect(reconcileSelection(remembered, [])).toEqual(remembered);
  expect(
    reconcileSelection(remembered, [
      info({ provider: 'grok', models: [{ id: 'g', name: 'G', efforts: [] }] }),
    ]),
  ).toEqual(remembered);
});

it('falls back when the provider, model, or effort is no longer valid', () => {
  const providers = [
    info({
      provider: 'codex',
      available: false,
      models: [],
    }),
    info({
      provider: 'grok',
      models: [
        { id: 'gone', name: 'Gone', efforts: [], unavailable: true },
        { id: 'grok-4', name: 'Grok 4', efforts: [{ id: 'low', label: 'low' }] },
      ],
    }),
  ];
  expect(reconcileSelection({ ...remembered, provider: 'codex' }, providers)).toMatchObject({
    provider: 'grok',
    model: '',
    effort: '',
  });
  expect(
    reconcileSelection(
      { ...remembered, provider: 'grok', model: 'gpt-5.6', effort: 'high', mode: 'full' },
      providers,
    ),
  ).toMatchObject({ provider: 'grok', model: 'grok-4', effort: '', mode: 'full' });
  expect(
    reconcileSelection(
      { ...remembered, provider: 'grok', model: 'grok-4', effort: 'max', taskMode: 'goal' },
      [
        info({
          provider: 'grok',
          taskModes: ['build'],
          models: [{ id: 'grok-4', name: 'Grok', efforts: [{ id: 'low', label: 'low' }] }],
        }),
      ],
    ),
  ).toMatchObject({ effort: '', taskMode: 'build' });
});

it('keeps a disabled provider until its CLI is actually missing', () => {
  expect(
    reconcileSelection(remembered, [info({ provider: 'codex', enabled: false })]).provider,
  ).toBe('codex');
});

it('does not promote an ordinary mode to full access', () => {
  expect(
    reconcileSelection(remembered, [
      info({ provider: 'codex', modes: [{ id: 'full', label: 'Full access' }] }),
    ]).mode,
  ).toBe('auto');
});

it('does not retarget an existing session onto another provider', () => {
  expect(
    reconcileSelection(remembered, [info({ provider: 'codex', enabled: false })], {
      lockProvider: true,
    }),
  ).toMatchObject({ provider: 'codex', model: 'gpt-5.6' });
});

it('reads incomplete saved values without throwing', () => {
  expect(readSelection({ provider: 'missing', mode: 'nope', model: 12 })).toEqual(defaultSelection);
  expect(
    readSelection({ provider: 'pi', mode: 'full', taskMode: 'goal', effort: 'x'.repeat(500) })
      .effort,
  ).toHaveLength(100);
});

it('persists selection in the shared store and restores it with the snapshot', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'moose-selection-')));
  dirs.push(dir);
  const store = new Store(join(dir, 'db.sqlite'));
  expect(store.getSelection()).toEqual(defaultSelection);
  store.setSelection({
    provider: 'pi',
    model: 'test/model',
    effort: 'high',
    mode: 'full',
    taskMode: 'plan',
  });
  store.close();
  const reopened = new Store(join(dir, 'db.sqlite'));
  expect(reopened.getSelection()).toMatchObject({
    provider: 'pi',
    model: 'test/model',
    effort: 'high',
    mode: 'full',
    taskMode: 'plan',
  });
  const service = new MooseService(reopened, () => {});
  try {
    const snapshot = (await service.handle('snapshot', {})) as { selection?: { provider: string } };
    expect(snapshot.selection?.provider).toBe('pi');
    await expect(
      service.handle('rememberSelection', {
        provider: 'opencode',
        model: 'alpha',
        effort: '',
        mode: 'ask',
        taskMode: 'build',
      }),
    ).resolves.toMatchObject({ provider: 'opencode', model: 'alpha', mode: 'ask' });
    expect(reopened.getSelection().provider).toBe('opencode');
  } finally {
    await service.close();
  }
});
