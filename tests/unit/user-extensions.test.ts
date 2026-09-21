import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'jsonc-parser';
import { UserExtensions } from '../../electron/providers/user-extensions';
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture(provider: 'pi' | 'opencode', input: string) {
  const dir = await mkdtemp(join(tmpdir(), 'moose-user-config-'));
  dirs.push(dir);
  await mkdir(join(dir, 'opencode'));
  const path = join(dir, provider === 'pi' ? 'settings.json' : 'opencode/opencode.jsonc');
  await writeFile(path, input);
  const client = new UserExtensions('/usr/bin/false', provider, {
    PI_CODING_AGENT_DIR: dir,
    XDG_CONFIG_HOME: dir,
  });
  return { dir, path, client, source: (await client.read(dir)).sources[0] };
}
it('updates Pi defaults without exposing secrets or rewriting unrelated settings', async () => {
  const f = await fixture(
    'pi',
    '{"defaultModel":"old","defaultProvider":"xai","secret":"SECRET_CANARY","packages":["npm:example"]}',
  );
  expect(JSON.stringify(await f.client.read(f.dir))).not.toContain('SECRET_CANARY');
  await f.client.change(
    f.dir,
    {
      type: 'config',
      sourceId: f.source.id,
      version: f.source.version,
      key: 'model',
      value: 'grok-4.6',
    },
    'id',
  );
  expect(parse(await readFile(f.path, 'utf8'))).toMatchObject({
    defaultModel: 'grok-4.6',
    defaultProvider: 'xai',
    secret: 'SECRET_CANARY',
  });
});
it('preserves JSONC comments and v2 server fields across toggle and refuses stale writes', async () => {
  const f = await fixture(
    'opencode',
    '{\n// keep\n"mcp":{"servers":{"test":{"type":"remote","url":"https://example.com","disabled":true,"headers":{"Authorization":"SECRET_CANARY"}}}}}',
  );
  expect(JSON.stringify(await f.client.read(f.dir))).not.toContain('SECRET_CANARY');
  const change = {
    type: 'toggle' as const,
    sourceId: f.source.id,
    version: f.source.version,
    category: 'mcp' as const,
    name: 'test',
    enabled: true,
  };
  await f.client.change(f.dir, change, 'id');
  expect(await readFile(f.path, 'utf8')).toContain('// keep');
  expect(parse(await readFile(f.path, 'utf8')).mcp.servers.test).toMatchObject({
    disabled: false,
    headers: { Authorization: 'SECRET_CANARY' },
  });
  await expect(f.client.change(f.dir, change, 'again')).rejects.toThrow('Configuration changed');
  expect((await f.client.read(f.dir)).mcp[0].enabled).toBe(true);
});
it('adds a disabled v2 MCP entry and detects external removal on the next read', async () => {
  const f = await fixture('opencode', '{}');
  await f.client.change(
    f.dir,
    {
      type: 'mcpAdd',
      sourceId: f.source.id,
      version: f.source.version,
      name: 'test',
      server: { transport: 'http', url: 'https://example.com', envHeaders: {} },
    },
    'id',
  );
  expect((await f.client.read(f.dir)).mcp).toMatchObject([{ name: 'test', enabled: false }]);
  expect(parse(await readFile(f.path, 'utf8')).mcp.servers.test.disabled).toBe(true);
  await writeFile(f.path, '{}');
  expect((await f.client.read(f.dir)).mcp).toEqual([]);
});
