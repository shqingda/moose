#!/usr/bin/env node
// Isolated protocol/CLI peer. Never touches real provider configuration.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
const file = join(process.cwd(), 'extensions-fixture.json');
const secret = 'SECRET_CANARY_NEVER_RENDER';
const read = () => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { version: 1, model: 'fixture-model', enabled: true, installed: false, writes: 0 };
  }
};
const save = (s) => writeFileSync(file, JSON.stringify(s));
if (process.argv.includes('--version')) {
  console.log('codex-cli 0.155.1');
  process.exit(0);
}
if (process.argv[2] === 'plugin') {
  const s = read(),
    plugin = {
      pluginId: 'fixture@local',
      name: 'fixture',
      marketplaceName: 'local',
      installed: s.installed,
      enabled: s.pluginEnabled !== false,
      installPolicy: 'AVAILABLE',
      authPolicy: 'ON_USE',
      source: { token: secret },
    };
  if (process.argv[3] === 'list')
    console.log(JSON.stringify({ installed: s.installed ? [plugin] : [], available: [plugin] }));
  else {
    if (process.argv.at(-1) !== plugin.pluginId) process.exit(2);
    s.installed = process.argv[3] === 'add';
    s.writes++;
    save(s);
    console.log('{}');
  }
  process.exit(0);
}
const send = (data) => process.stdout.write(JSON.stringify(data) + '\n');
const result = (id, value) => send({ id, result: value });
for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params: p } = JSON.parse(line),
    s = read();
  if (id === undefined) continue;
  const user = {
    name: { type: 'user', file: join(process.cwd(), 'config.toml'), profile: null },
    version: String(s.version),
  };
  switch (method) {
    case 'initialize':
      result(id, { userAgent: 'codex/0.155.1' });
      break;
    case 'account/read':
      result(id, { account: { type: 'apiKey' }, requiresOpenaiAuth: false });
      break;
    case 'model/list':
      result(id, { data: [], nextCursor: null });
      break;
    case 'config/read':
      result(id, {
        config: {
          model: s.model,
          mcp_servers: { fixture: { enabled: s.enabled, env: { KEY: secret } }, ...s.mcp },
          api_key: secret,
        },
        origins: { model: user },
        layers: [
          { ...user, config: { secret, mcp_servers: s.mcp || {} } },
          {
            name: { type: 'project', dotCodexFolder: join(process.cwd(), '.codex') },
            version: 'project',
            config: { secret, mcp_servers: s.hiddenMcp || {} },
          },
        ],
      });
      break;
    case 'config/value/write':
      if (p.expectedVersion !== String(s.version) || p.filePath !== user.name.file) {
        send({ id, error: { code: -1, message: secret } });
        break;
      }
      if (p.keyPath === 'mcp_servers') s.mcp = p.value;
      else if (p.keyPath === 'model') s.model = p.value;
      else if (p.keyPath === 'mcp_servers."fixture".enabled') s.enabled = p.value;
      else if (/^mcp_servers\."[A-Za-z0-9_-]+"$/.test(p.keyPath)) {
        const name = JSON.parse(p.keyPath.slice('mcp_servers.'.length));
        s.mcp = { ...s.mcp, [name]: p.value };
      } else if (/^mcp_servers\."[A-Za-z0-9_-]+"\.enabled$/.test(p.keyPath)) {
        const name = JSON.parse(p.keyPath.slice('mcp_servers.'.length, -'.enabled'.length));
        if (!s.mcp || !Object.hasOwn(s.mcp, name)) {
          send({ id, error: { code: -1, message: secret } });
          break;
        }
        s.mcp[name].enabled = p.value;
      } else if (p.keyPath === 'plugins."fixture@local".enabled') s.pluginEnabled = p.value;
      else {
        send({ id, error: { code: -1, message: secret } });
        break;
      }
      s.version++;
      s.writes++;
      save(s);
      result(id, {});
      break;
    case 'hooks/list':
      result(id, {
        data: [
          {
            cwd: process.cwd(),
            hooks: [
              {
                key: 'hook',
                eventName: 'PreToolUse',
                sourcePath: join(process.cwd(), 'hooks.json'),
                enabled: true,
                handlerType: 'command',
                command: secret,
              },
            ],
            errors: [{ path: join(process.cwd(), 'invalid-hook.json'), message: secret }],
            warnings: [],
          },
        ],
      });
      break;
    case 'mcpServerStatus/list':
      if (s.mcpError) send({ id, error: { code: -1, message: secret } });
      else
        result(id, {
          data: [
            { name: 'fixture', authStatus: 'notLoggedIn', tools: { test: {} }, toolsError: null },
          ],
          nextCursor: null,
        });
      break;
    case 'mcpServer/oauth/login': {
      const finish = () =>
        send({
          method: 'mcpServer/oauthLogin/completed',
          params: { name: p.name, success: s.auth !== 'fail', error: secret },
        });
      if (s.auth === 'early') finish();
      result(id, {
        authorizationUrl:
          s.auth === 'unsafe'
            ? 'http://example.invalid/secret'
            : 'https://example.invalid/oauth?secret=' + secret,
      });
      if (s.auth === 'success' || s.auth === 'fail') setTimeout(finish, 100);
      break;
    }
    default:
      send({ id, error: { code: -32601, message: secret } });
  }
}
