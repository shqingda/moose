import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
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
function rememberConfig(store: Store, cwd: string) {
  const key = `extension-cache:codex:${createHash('sha256').update(cwd).digest('hex')}`;
  store.sqlite.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run(
    key,
    JSON.stringify({
      supported: true,
      version: 'codex/9.9.9',
      cwd,
      sources: [
        {
          id: 'user',
          kind: 'user',
          path: join(cwd, 'config.toml'),
          version: '1',
          writable: true,
          disabled: false,
        },
      ],
      settings: [{ key: 'model', value: 'cached-model', source: 'user' }],
      mcp: [],
      plugins: [],
      hooks: [],
      diagnostics: [],
    }),
  );
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
  rememberConfig(store, store.directory(project.id));
  const extensions = new Extensions(store, {
    path: async () => path,
    lock: () => () => {},
  });
  const scope = { projectId: project.id, provider: 'codex' as const };
  try {
    const contentStarted = performance.now();
    const cached = (await extensions.handle('extensionsRead', {
      ...scope,
      cached: true,
    })) as ExtensionSnapshot;
    const contentMs = performance.now() - contentStarted;
    expect(cached.settings[0]?.value).toBe('cached-model');
    expect(contentMs).toBeLessThan(50);
    const started = performance.now();
    const live = extensions.handle('extensionsRead', scope) as Promise<ExtensionSnapshot>;
    const duringStarted = performance.now();
    const during = (await extensions.handle('extensionsRead', {
      ...scope,
      cached: true,
    })) as ExtensionSnapshot;
    const duringMs = performance.now() - duringStarted;
    expect(during.settings[0]?.value).toBe('cached-model');
    expect(duringMs).toBeLessThan(50);
    const fresh = await live;
    const statusMs = performance.now() - started;
    expect(fresh.reason).toBe('timeout');
    expect(fresh.settings[0]?.value).toBe('cached-model');
    expect(statusMs).toBeGreaterThan(1500);
    expect(statusMs).toBeLessThan(3500);
    console.info(
      `config hung CLI: time-to-content ${contentMs.toFixed(1)} ms, still cached while waiting ${duringMs.toFixed(1)} ms, timeout status ${statusMs.toFixed(0)} ms`,
    );
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
  rememberConfig(store, store.directory(project.id));
  const extensions = new Extensions(store, {
    path: async () => path,
    lock: () => () => {},
  });
  try {
    const contentStarted = performance.now();
    const cached = (await extensions.handle('extensionsRead', {
      projectId: project.id,
      provider: 'codex',
      cached: true,
    })) as ExtensionSnapshot;
    const contentMs = performance.now() - contentStarted;
    expect(cached.settings[0]?.value).toBe('cached-model');
    expect(contentMs).toBeLessThan(50);
    const started = performance.now();
    const fresh = (await extensions.handle('extensionsRead', {
      projectId: project.id,
      provider: 'codex',
    })) as ExtensionSnapshot;
    const statusMs = performance.now() - started;
    expect(fresh.reason).toBe('subscription');
    expect(fresh.settings[0]?.value).toBe('cached-model');
    expect(statusMs).toBeLessThan(1000);
    console.info(
      `config entitlement error: time-to-content ${contentMs.toFixed(1)} ms, status ${statusMs.toFixed(0)} ms`,
    );
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
