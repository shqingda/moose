import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../../electron/db/store';
import { ProviderRegistry } from '../../electron/provider-registry';
import { createAdapter } from '../../electron/providers/registry';
import { CodexAdapter } from '../../electron/providers/codex';
import { GrokAdapter } from '../../electron/providers/grok';
import { PiAdapter } from '../../electron/providers/pi';
import { OpenCodeAdapter } from '../../electron/providers/opencode';
import type { AgentAdapter, RunContext } from '../../electron/providers/types';
import type { Provider, Session } from '../../shared/types';

const fixtures = {
  codex: {
    path: resolve('tests/fixtures/agent.mjs'),
    hold: 'hold',
    mode: 'ask',
    Static: CodexAdapter,
  },
  grok: {
    path: resolve('tests/fixtures/agent.mjs'),
    hold: 'hold',
    mode: 'ask',
    Static: GrokAdapter,
  },
  pi: { path: resolve('tests/fixtures/pi.mjs'), hold: 'wait', mode: 'full', Static: PiAdapter },
  opencode: {
    path: resolve('tests/fixtures/opencode.mjs'),
    hold: 'hold',
    mode: 'ask',
    Static: OpenCodeAdapter,
  },
} satisfies Record<Provider, unknown>;
const providers = Object.keys(fixtures) as Provider[];
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** Starts a prompt the fixture never finishes and resolves once the CLI reported its session. */
async function held(provider: Provider) {
  const adapter = await createAdapter(provider, fixtures[provider].path);
  cleanups.push(() => adapter.close());
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const context: RunContext = {
    cwd: process.cwd(),
    text: fixtures[provider].hold,
    session: {
      id: `held-${provider}`,
      provider,
      nativeId: null,
      model: '',
      effort: '',
      mode: fixtures[provider].mode,
    } as Session,
    emit: () => {},
    nativeId: started,
  };
  const run = adapter.run(context).then(
    () => 'settled',
    () => 'settled',
  );
  await ready;
  return { adapter, run };
}

it('probes all four providers through lazily loaded adapters with unchanged results', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'moose-adapter-loading-'));
  const store = new Store(join(dir, 'db.sqlite'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  cleanups.push(() => store.close());
  store.setSettings({
    codexPath: fixtures.codex.path,
    grokPath: fixtures.grok.path,
    piPath: fixtures.pi.path,
    opencodePath: fixtures.opencode.path,
  });
  const registry = new ProviderRegistry(store);
  cleanups.push(() => registry.close());
  const probed = await registry.providers(true);
  expect(probed.map((info) => [info.provider, info.connected, info.error])).toEqual(
    providers.map((provider) => [provider, true, undefined]),
  );
  for (const provider of providers) {
    const direct = new fixtures[provider].Static(fixtures[provider].path);
    try {
      expect(probed.find((info) => info.provider === provider)).toMatchObject(await direct.probe());
    } finally {
      await direct.close();
    }
  }
});

it.each(providers)('cancels a live %s prompt from a lazily loaded adapter', async (provider) => {
  const { adapter, run } = await held(provider);
  await adapter.cancel();
  expect(await run).toBe('settled');
});

it.each(providers)('shuts down a live %s prompt from a lazily loaded adapter', async (provider) => {
  const { adapter, run }: { adapter: AgentAdapter; run: Promise<string> } = await held(provider);
  await adapter.close();
  expect(await run).toBe('settled');
});
