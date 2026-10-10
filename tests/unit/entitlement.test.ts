import { afterEach, expect, it, vi } from 'vitest';
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Extensions } from '../../electron/extensions';
import { MooseService } from '../../electron/service';
import { Store } from '../../electron/db/store';
import { entitlementKind } from '../../shared/entitlement';
import type { ExtensionSnapshot } from '../../shared/extensions';
import type { RunContext } from '../../electron/providers/types';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('recognizes subscription, model, and sign-in failures', () => {
  expect(entitlementKind('Your ChatGPT Pro subscription expired')).toBe('subscription');
  expect(entitlementKind('The model is unavailable for this account')).toBe('model');
  expect(entitlementKind('Sign in with `codex login`')).toBe('auth');
  expect(entitlementKind('initialize timed out')).toBeUndefined();
});

function script(dir: string, body: string) {
  const path = join(dir, 'codex.mjs');
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return path;
}

it('shows cached configuration immediately and bounds a hanging CLI', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'moose-ext-hang-')));
  dirs.push(dir);
  const store = new Store(join(dir, 'db.sqlite'));
  const project = store.addProject(dir);
  const path = script(
    dir,
    `#!/usr/bin/env node
process.stdin.resume();
setInterval(() => {}, 1 << 30);
`,
  );
  const extensions = new Extensions(store, {
    path: async () => path,
    lock: () => () => {},
  });
  const scope = { projectId: project.id, provider: 'codex' as const };
  try {
    const cachedStarted = performance.now();
    const cached = (await extensions.handle('extensionsRead', {
      ...scope,
      cached: true,
    })) as ExtensionSnapshot;
    const cachedMs = performance.now() - cachedStarted;
    expect(cached.pending).toBe(true);
    expect(cachedMs).toBeLessThan(200);
    const started = performance.now();
    const fresh = (await extensions.handle('extensionsRead', scope)) as ExtensionSnapshot;
    const elapsed = performance.now() - started;
    expect(fresh.reason).toBe('timeout');
    expect(elapsed).toBeGreaterThan(1000);
    expect(elapsed).toBeLessThan(9000);
  } finally {
    await extensions.close();
    store.close();
  }
}, 15000);

it('returns a subscription error without waiting on a later CLI call', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'moose-ext-sub-')));
  dirs.push(dir);
  const store = new Store(join(dir, 'db.sqlite'));
  const project = store.addProject(dir);
  const path = script(
    dir,
    `#!/usr/bin/env node
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  if (!buffer.includes('\\n')) return;
  const line = buffer.slice(0, buffer.indexOf('\\n'));
  const message = JSON.parse(line);
  process.stdout.write(
    JSON.stringify({
      id: message.id,
      error: { code: 1, message: 'subscription expired' },
    }) + '\\n',
  );
});
`,
  );
  const extensions = new Extensions(store, {
    path: async () => path,
    lock: () => () => {},
  });
  try {
    const started = performance.now();
    const fresh = (await extensions.handle('extensionsRead', {
      projectId: project.id,
      provider: 'codex',
    })) as ExtensionSnapshot;
    expect(fresh.reason).toBe('subscription');
    expect(performance.now() - started).toBeLessThan(2000);
    const again = (await extensions.handle('extensionsRead', {
      projectId: project.id,
      provider: 'codex',
      cached: true,
    })) as ExtensionSnapshot;
    expect(again.pending).toBe(true);
  } finally {
    await extensions.close();
    store.close();
  }
});

it('hides a model after the provider reports it unavailable', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'moose-model-')));
  dirs.push(dir);
  const store = new Store(join(dir, 'db.sqlite'));
  store.setSettings({ codexPath: resolve('tests/fixtures/agent.mjs') });
  let complete = () => {};
  const service = new MooseService(
    store,
    () => {},
    () => ({
      async probe() {
        return { models: [], modes: [] };
      },
      async run(context: RunContext) {
        context.emit({ key: 'start', kind: 'assistant', text: 'starting', state: 'running' });
        throw new Error('The model is unavailable');
      },
      respond() {},
      async cancel() {
        complete();
      },
      async close() {
        complete();
      },
    }),
  );
  try {
    const session = store.createSession(store.addProject(dir).id, 'codex');
    store.updateSession(session.id, { model: 'gpt-retired' });
    await service.handle('send', { sessionId: session.id, text: 'hello' });
    await vi.waitFor(() => {
      expect(store.allMessages(session.id).map((message) => message.text)).toContain(
        'Model unavailable',
      );
    });
    expect(store.unavailableModels().codex).toContain('gpt-retired');
    const snapshot = (await service.handle('snapshot', {})) as {
      unavailableModels?: { codex?: string[] };
    };
    expect(snapshot.unavailableModels?.codex).toContain('gpt-retired');
  } finally {
    await service.close();
  }
});
