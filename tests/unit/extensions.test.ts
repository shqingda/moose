import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../../electron/db/store';
import { Extensions } from '../../electron/extensions';
import type { ExtensionSnapshot, ExtensionAuth } from '../../shared/extensions';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
function fixture() {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'moose-extensions-'))),
    store = new Store(join(cwd, 'data.sqlite'));
  const project = store.addProject(cwd),
    scope = { projectId: project.id, provider: 'codex' as const };
  let locked = false;
  const hooks = {
    path: async () => resolve('tests/fixtures/extensions.mjs'),
    lock: () => {
      if (locked) throw new Error('busy');
      locked = true;
      return () => {
        locked = false;
      };
    },
  };
  const extensions = new Extensions(store, hooks);
  cleanup.push(async () => {
    await extensions.close();
    store.close();
    rmSync(cwd, { recursive: true, force: true });
  });
  const set = (extra: object) =>
    writeFileSync(
      join(cwd, 'extensions-fixture.json'),
      JSON.stringify({
        version: 1,
        model: 'fixture-model',
        enabled: true,
        installed: false,
        writes: 0,
        ...extra,
      }),
    );
  const read = () => JSON.parse(readFileSync(join(cwd, 'extensions-fixture.json'), 'utf8'));
  const snapshot = () => extensions.handle('extensionsRead', scope) as Promise<ExtensionSnapshot>;
  return { cwd, store, scope, extensions, set, read, snapshot, hooks };
}
it('returns only config provenance and extension metadata, never secrets or commands', async () => {
  const f = fixture();
  f.set({ mcpError: true });
  const s = await f.snapshot();
  expect(s.supported).toBe(true);
  expect(s.sources.map((x) => x.writable)).toEqual([true, false]);
  expect(s.settings[0].source).toBe(s.sources[0].id);
  expect(s.hooks[0].event).toBe('PreToolUse');
  expect(s.diagnostics.map((d) => d.area)).toEqual(['hooks', 'mcp']);
  expect(JSON.stringify(s)).not.toContain('SECRET_CANARY');
});
it('writes a versioned user setting, verifies it and deduplicates retry without replay', async () => {
  const f = fixture(),
    s = await f.snapshot();
  const args = {
    ...f.scope,
    requestId: randomUUID(),
    change: {
      type: 'config',
      sourceId: s.sources[0].id,
      version: s.sources[0].version,
      key: 'model',
      value: 'new-model',
    },
  };
  const methodsBefore = readFileSync(
    join(f.store.directory(f.scope.projectId), 'extension-methods.log'),
    'utf8',
  ).split('\n');
  const next = (await f.extensions.handle('extensionsChange', args)) as ExtensionSnapshot;
  const methodsAfter = readFileSync(
    join(f.store.directory(f.scope.projectId), 'extension-methods.log'),
    'utf8',
  ).split('\n');
  expect(methodsAfter.slice(methodsBefore.length - 1)).not.toContain('mcpServerStatus/list');
  expect(
    methodsAfter.slice(methodsBefore.length - 1).filter((method) => method === 'initialize'),
  ).toHaveLength(1);
  expect(next.settings[0].value).toBe('new-model');
  expect(f.read().writes).toBe(1);
  await f.extensions.handle('extensionsChange', args);
  expect(f.read().writes).toBe(1);
  await expect(
    f.extensions.handle('extensionsChange', {
      ...args,
      change: { ...args.change, value: 'other' },
    }),
  ).rejects.toThrow('already used');
  expect(JSON.stringify(f.store.sqlite.prepare('SELECT value FROM settings').all())).not.toContain(
    'SECRET_CANARY',
  );
});
it('rejects stale versions and project writes without changing configuration', async () => {
  const f = fixture();
  f.set({ version: 2 });
  const s = await f.snapshot();
  for (const source of [s.sources[0], s.sources[1]])
    await expect(
      f.extensions.handle('extensionsChange', {
        ...f.scope,
        requestId: randomUUID(),
        change: { type: 'config', sourceId: source.id, version: '1', key: 'model', value: 'bad' },
      }),
    ).rejects.toThrow('not fully verified');
  expect(f.read().writes).toBe(0);
});
it('manages plugin installation using the native CLI and changes only named enabled keys', async () => {
  const f = fixture();
  await f.extensions.handle('extensionsChange', {
    ...f.scope,
    requestId: randomUUID(),
    change: { type: 'plugin', id: 'fixture@local', action: 'install' },
  });
  let s = await f.snapshot();
  expect(s.plugins[0].installed).toBe(true);
  for (const category of ['mcp', 'plugin']) {
    s = await f.snapshot();
    await f.extensions.handle('extensionsChange', {
      ...f.scope,
      requestId: randomUUID(),
      change: {
        type: 'toggle',
        sourceId: s.sources[0].id,
        version: s.sources[0].version,
        category,
        name: category === 'mcp' ? 'fixture' : 'fixture@local',
        enabled: false,
      },
    });
  }
  expect(f.read()).toMatchObject({ enabled: false, pluginEnabled: false, model: 'fixture-model' });
  await f.extensions.handle('extensionsChange', {
    ...f.scope,
    requestId: randomUUID(),
    change: { type: 'plugin', id: 'fixture@local', action: 'uninstall' },
  });
  expect(f.read().installed).toBe(false);
});
it.each(['early', 'success', 'fail', 'pending', 'unsafe'])(
  'handles OAuth %s without persisting URLs or tokens',
  async (mode) => {
    const f = fixture();
    f.set({ auth: mode });
    const id = randomUUID(),
      start = f.extensions.handle('extensionsLogin', {
        ...f.scope,
        name: 'fixture',
        requestId: id,
      });
    if (mode === 'unsafe') {
      await expect(start).rejects.toThrow('could not start');
      return;
    }
    const response = (await start) as ExtensionAuth & { url: string };
    expect(response.url).toMatch(/^https:/);
    if (mode === 'pending') {
      await f.extensions.handle('extensionsAuth', { id, cancel: true });
    }
    await vi.waitFor(async () =>
      expect(((await f.extensions.handle('extensionsAuth', { id })) as ExtensionAuth).status).toBe(
        mode === 'fail' ? 'failed' : mode === 'pending' ? 'cancelled' : 'completed',
      ),
    );
    expect(
      JSON.stringify(f.store.sqlite.prepare('SELECT value FROM settings').all()),
    ).not.toContain('SECRET_CANARY');
  },
);
it('reserves OAuth start before async discovery and rejects concurrent starts', async () => {
  const f = fixture();
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      f.extensions.handle('extensionsLogin', {
        ...f.scope,
        name: 'fixture',
        requestId: randomUUID(),
      }),
    ),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
});
it('recovers uncertain writes without replay', async () => {
  const f = fixture(),
    id = randomUUID();
  f.store.sqlite
    .prepare('INSERT INTO settings(key,value) VALUES(?,?)')
    .run(
      'extension-operation:' + id,
      JSON.stringify({ fingerprint: 'x', status: 'running', projectId: f.scope.projectId }),
    );
  const next = new Extensions(f.store, f.hooks);
  await next.close();
  expect(
    (
      f.store.sqlite
        .prepare('SELECT value FROM settings WHERE key=?')
        .get('extension-operation:' + id) as { value: string }
    ).value,
  ).toContain('unknown');
});
it('serializes concurrent writes and does not start commands after closing a client', async () => {
  const f = fixture(),
    s = await f.snapshot();
  const args = {
    ...f.scope,
    requestId: randomUUID(),
    change: {
      type: 'config',
      sourceId: s.sources[0].id,
      version: s.sources[0].version,
      key: 'model',
      value: 'new-model',
    },
  };
  const running = f.extensions.handle('extensionsChange', args);
  await expect(
    f.extensions.handle('extensionsChange', { ...args, requestId: randomUUID() }),
  ).rejects.toThrow('busy');
  await running;
  expect(f.read().writes).toBe(1);
  const { CodexPlugins } = await import('../../electron/providers/codex-plugins');
  const plugins = new CodexPlugins(resolve('tests/fixtures/extensions.mjs'));
  await plugins.close();
  await expect(plugins.change(f.cwd, 'fixture@local', 'install')).rejects.toThrow('closed');
  expect(f.read().writes).toBe(1);
});
it('cancels pending authentication on shutdown and allows a new login after failure', async () => {
  const f = fixture();
  f.set({ auth: 'fail' });
  const id = randomUUID();
  await f.extensions.handle('extensionsLogin', { ...f.scope, name: 'fixture', requestId: id });
  await vi.waitFor(async () =>
    expect(((await f.extensions.handle('extensionsAuth', { id })) as ExtensionAuth).status).toBe(
      'failed',
    ),
  );
  f.set({ auth: 'pending' });
  await f.extensions.handle('extensionsLogin', {
    ...f.scope,
    name: 'fixture',
    requestId: randomUUID(),
  });
  await f.extensions.close();
  await expect(f.extensions.handle('extensionsRead', f.scope)).rejects.toThrow('shutting down');
});
it.each([
  {
    transport: 'http' as const,
    url: 'https://example.invalid/mcp',
    bearerTokenEnvVar: 'MCP_TOKEN',
  },
  {
    transport: 'stdio' as const,
    command: '/tmp/path with spaces/server',
    args: ['--name', 'two words', '$(do-not-execute)'],
    envVars: ['MCP_TOKEN'],
  },
])(
  'registers a disabled MCP server without replacing unrelated configuration: $transport',
  async (server) => {
    const f = fixture(),
      snapshot = await f.snapshot();
    const args = {
      ...f.scope,
      requestId: randomUUID(),
      change: {
        type: 'mcpAdd',
        sourceId: snapshot.sources[0].id,
        version: snapshot.sources[0].version,
        name: 'new_server',
        server,
      },
    };
    const result = (await f.extensions.handle('extensionsChange', args)) as ExtensionSnapshot;
    expect(result.mcp.find((s) => s.name === 'new_server')?.enabled).toBe(false);
    expect(f.read().mcp.new_server.enabled).toBe(false);
    expect(f.read().model).toBe('fixture-model');
    if (server.transport === 'stdio') expect(f.read().mcp.new_server.args).toEqual(server.args);
    else expect(f.read().mcp.new_server.bearer_token_env_var).toBe('MCP_TOKEN');
    await f.extensions.handle('extensionsChange', args);
    expect(f.read().writes).toBe(1);
    expect(JSON.stringify(result)).not.toContain('do-not-execute');
    expect(
      JSON.stringify(f.store.sqlite.prepare('SELECT value FROM settings').all()),
    ).not.toContain('MCP_TOKEN');
  },
);
it('rejects MCP duplicates even in disabled configuration layers and rejects stale registration', async () => {
  const f = fixture();
  f.set({ hiddenMcp: { hidden: { command: 'untouched' } } });
  const snapshot = await f.snapshot();
  for (const [name, version] of [
    ['fixture', '1'],
    ['hidden', '1'],
    ['fresh', 'stale'],
  ])
    await expect(
      f.extensions.handle('extensionsChange', {
        ...f.scope,
        requestId: randomUUID(),
        change: {
          type: 'mcpAdd',
          sourceId: snapshot.sources[0].id,
          version,
          name,
          server: { transport: 'http', url: 'https://example.invalid/mcp' },
        },
      }),
    ).rejects.toThrow('not fully verified');
  expect(f.read().writes).toBe(0);
  expect(f.read().hiddenMcp.hidden.command).toBe('untouched');
});
it('validates MCP transport, secrets references and arguments before crossing IPC', async () => {
  const { validate } = await import('../../shared/validation');
  const f = fixture(),
    snapshot = await f.snapshot();
  const args = {
    ...f.scope,
    requestId: randomUUID(),
    change: {
      type: 'mcpAdd',
      sourceId: snapshot.sources[0].id,
      version: '1',
      name: 'fresh',
      server: { transport: 'http', url: 'https://example.invalid/mcp' },
    },
  };
  for (const url of [
    'file:///tmp/server',
    'https://user:secret@example.invalid/mcp',
    'https://example.invalid/mcp?token=secret',
    'http://example.invalid/mcp',
  ])
    expect(() =>
      validate('extensionsChange', {
        ...args,
        change: { ...args.change, server: { transport: 'http', url } },
      }),
    ).toThrow();
  expect(() =>
    validate('extensionsChange', {
      ...args,
      change: { ...args.change, server: { transport: 'http', url: 'http://127.0.0.1:3000/mcp' } },
    }),
  ).not.toThrow();
  expect(() =>
    validate('extensionsChange', {
      ...args,
      change: {
        ...args.change,
        server: { transport: 'stdio', command: 'node', args: [1], envVars: [] },
      },
    }),
  ).toThrow();
  expect(() =>
    validate('extensionsChange', {
      ...args,
      change: {
        ...args.change,
        server: { transport: 'stdio', command: 'node', args: [], envVars: ['KEY=secret'] },
      },
    }),
  ).toThrow();
});
it('edits a connection while preserving credentials and unrelated user entries', async () => {
  const f = fixture();
  f.set({
    mcp: {
      owned: {
        url: 'https://old.invalid/mcp',
        enabled: true,
        http_headers: { Authorization: 'SECRET_CANARY' },
        startup_timeout_sec: 60,
      },
      other: { command: 'keep-me', env: { TOKEN: 'SECRET_CANARY' } },
    },
  });
  let s = await f.snapshot();
  expect(s.mcp.find((x) => x.name === 'owned')).toMatchObject({
    sourceId: s.sources[0].id,
    transport: 'http',
  });
  const args = {
    ...f.scope,
    requestId: randomUUID(),
    change: {
      type: 'mcpEdit',
      sourceId: s.sources[0].id,
      version: s.sources[0].version,
      name: 'owned',
      server: { transport: 'http', url: 'https://new.invalid/mcp' },
    },
  };
  await f.extensions.handle('extensionsChange', args);
  expect(f.read().mcp.owned).toEqual({
    url: 'https://new.invalid/mcp',
    enabled: true,
    http_headers: { Authorization: 'SECRET_CANARY' },
    startup_timeout_sec: 60,
  });
  await f.extensions.handle('extensionsChange', args);
  expect(f.read().writes).toBe(1);
  s = await f.snapshot();
  expect(JSON.stringify(s)).not.toContain('SECRET_CANARY');
  expect(f.read().mcp.other).toEqual({ command: 'keep-me', env: { TOKEN: 'SECRET_CANARY' } });
  expect(f.read().model).toBe('fixture-model');
});
it('rejects stale MCP edits, inherited edits and transport changes', async () => {
  const f = fixture();
  f.set({ mcp: { owned: { command: 'node', enabled: false } } });
  const s = await f.snapshot();
  for (const change of [
    {
      type: 'mcpEdit',
      name: 'fixture',
      version: '1',
      server: { transport: 'http', url: 'https://example.invalid/mcp' },
    },
    {
      type: 'mcpEdit',
      name: 'owned',
      version: 'old',
      server: { transport: 'http', url: 'https://example.invalid/mcp' },
    },
    {
      type: 'mcpEdit',
      name: 'owned',
      version: '1',
      server: { transport: 'http', url: 'https://example.invalid/mcp' },
    },
  ])
    await expect(
      f.extensions.handle('extensionsChange', {
        ...f.scope,
        requestId: randomUUID(),
        change: { sourceId: s.sources[0].id, ...change },
      }),
    ).rejects.toThrow('not fully verified');
  expect(f.read().writes).toBe(0);
});
it('validates header references and preserves unrelated headers during edits', async () => {
  const { mcpRegistration } = await import('../../shared/mcp-registration');
  for (const envHeaders of [
    { 'bad\r\nheader': 'TOKEN' },
    { 'X-Key': 'secret-value' },
    { 'X-Key': 'A', 'x-key': 'B' },
  ])
    expect(() =>
      mcpRegistration.parse({ transport: 'http', url: 'https://example.invalid/mcp', envHeaders }),
    ).toThrow();
  const f = fixture();
  f.set({
    mcp: {
      owned: {
        url: 'https://old.invalid/mcp',
        enabled: false,
        env_http_headers: { 'X-Existing': 'EXISTING', 'x-key': 'OLD' },
        http_headers: { Authorization: 'SECRET_CANARY' },
      },
    },
  });
  const s = await f.snapshot();
  await f.extensions.handle('extensionsChange', {
    ...f.scope,
    requestId: randomUUID(),
    change: {
      type: 'mcpEdit',
      sourceId: s.sources[0].id,
      version: s.sources[0].version,
      name: 'owned',
      server: { transport: 'http', url: 'https://new.invalid/mcp', envHeaders: { 'X-Key': 'NEW' } },
    },
  });
  expect(f.read().mcp.owned.env_http_headers).toEqual({ 'X-Existing': 'EXISTING', 'X-Key': 'NEW' });
  expect(f.read().mcp.owned.http_headers.Authorization).toBe('SECRET_CANARY');
});

it('omits runtime-only MCP servers that have no editable configuration', async () => {
  const f = fixture();
  const snapshot = await f.snapshot();
  expect(snapshot.mcp.map((server) => server.name)).toEqual(['fixture']);
});
