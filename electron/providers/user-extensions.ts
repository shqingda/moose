import { parse as parseToml } from 'smol-toml';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile, mkdir, open, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parse, modify, applyEdits, type ParseError } from 'jsonc-parser';
import { agentEnvironment, spawnAgent, terminate } from './process';
import { record, string, array } from './types';
import type { ExtensionChange, ExtensionSnapshot } from '../../shared/extensions';
import type { Provider } from '../../shared/types';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
async function text(path: string) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}
function json(content: string) {
  const errors: ParseError[] = [];
  const value = parse(content || '{}', errors, { allowTrailingComma: true });
  if (errors.length || !value || Array.isArray(value) || typeof value !== 'object')
    throw new Error('Invalid user configuration');
  return record(value);
}
/** Other CLIs keep their own config formats; only allowlisted fields reach the UI. */
export class UserExtensions {
  private closed = false;
  private children = new Set<ChildProcessWithoutNullStreams>();
  constructor(
    private path: string,
    private provider: Exclude<Provider, 'codex'>,
    private env: NodeJS.ProcessEnv = agentEnvironment(),
  ) {}
  private async run(args: string[], cwd: string): Promise<string> {
    if (this.closed) throw new Error('Configuration client is closed');
    const child = spawnAgent(this.path, args, cwd, this.env);
    this.children.add(child);
    child.stdin.end();
    child.stderr.resume();
    return new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => {
        void terminate(child);
        reject(new Error('Configuration command timed out'));
      }, 120000);
      const clean = () => {
        clearTimeout(timer);
        this.children.delete(child);
      };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        output += chunk;
        if (output.length > 4 * 1024 * 1024) {
          void terminate(child);
          reject(new Error('Configuration output is too large'));
        }
      });
      child.once('error', () => {
        clean();
        reject(new Error('Configuration command could not start'));
      });
      child.once('close', (code) => {
        clean();
        if (code === 0) resolve(output);
        else reject(new Error('Configuration command failed'));
      });
    });
  }
  private directory() {
    if (this.provider === 'pi') return this.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi/agent');
    if (this.provider === 'grok') return this.env.GROK_HOME || join(homedir(), '.grok');
    return join(this.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'opencode');
  }
  private async file() {
    const directory = this.directory();
    if (this.provider === 'pi') return join(directory, 'settings.json');
    if (this.provider === 'grok') return join(directory, 'config.toml');
    const commented = join(directory, 'opencode.jsonc');
    return (await text(commented)) ? commented : join(directory, 'opencode.json');
  }
  async read(cwd: string): Promise<ExtensionSnapshot> {
    if (this.closed) throw new Error('Configuration client is closed');
    const path = await this.file(),
      content = await text(path);
    const snapshot: ExtensionSnapshot = {
      supported: true,
      version: '',
      cwd,
      sources: [
        {
          id: hash(path),
          kind: 'user',
          path,
          version: hash(content),
          writable: true,
          disabled: false,
        },
      ],
      settings: [],
      mcp: [],
      plugins: [],
      hooks: [],
      diagnostics: [],
      capabilities: {
        model: this.provider !== 'grok',
        mcp: this.provider !== 'pi',
        mcpEdit: this.provider === 'opencode',
        auth: false,
        pluginToggle: this.provider === 'grok',
        pluginInstall: true,
        diagnostics: false,
      },
    };
    if (this.provider === 'grok') {
      const servers = JSON.parse(await this.run(['mcp', 'list', '--json'], cwd));
      snapshot.mcp = array(servers)
        .filter((item) => record(item).scope === 'user')
        .map((item) => {
          const s = record(item);
          return {
            name: string(s.name),
            enabled: s.enabled !== false,
            auth: 'unknown',
            tools: 0,
            failed: false,
            sourceId: hash(path),
          };
        });
      const plugins = JSON.parse(await this.run(['plugin', 'list', '--json'], cwd));
      const config = parseToml(content || '');
      const disabled = array(record(config.plugins).disabled);
      const defaultModel = string(record(config.models).default);
      if (defaultModel)
        snapshot.settings.push({ key: 'model', value: defaultModel, source: hash(path) });
      snapshot.plugins = array(plugins).map((item) => {
        const p = record(item),
          name = string(p.name);
        return {
          id: name,
          name,
          marketplace: '',
          installedFrom: string(p.source),
          installed: true,
          enabled: !disabled.includes(name),
          installable: false,
          removable: true,
        };
      });
      return snapshot;
    }
    const config = json(content);
    const model = this.provider === 'pi' ? string(config.defaultModel) : string(config.model);
    if (model) snapshot.settings.push({ key: 'model', value: model, source: hash(path) });
    if (this.provider === 'pi' && config.defaultProvider)
      snapshot.settings.push({
        key: 'provider',
        value: string(config.defaultProvider),
        source: hash(path),
      });
    if (this.provider === 'opencode') {
      const mcp = record(config.mcp);
      const servers = 'servers' in mcp ? record(mcp.servers) : mcp;
      snapshot.mcp = Object.entries(servers)
        .filter(([, value]) => ['local', 'remote'].includes(string(record(value).type)))
        .map(([name, value]) => {
          const s = record(value);
          return {
            name,
            enabled: s.disabled !== true && s.enabled !== false,
            auth: 'unknown',
            tools: 0,
            failed: false,
            sourceId: hash(path),
            transport: s.type === 'local' ? 'stdio' : 'http',
          };
        });
    }
    const packages = this.provider === 'pi' ? config.packages : config.plugins || config.plugin;
    snapshot.plugins = array(packages)
      .map((item) => {
        const name =
          typeof item === 'string'
            ? item
            : string(record(item)[this.provider === 'pi' ? 'source' : 'package']);
        return {
          id:
            this.provider === 'pi' && (name.startsWith('.') || name.startsWith('/'))
              ? resolve(this.directory(), name)
              : name,
          name,
          marketplace: '',
          installed: true,
          enabled: true,
          installable: false,
          removable: true,
        };
      })
      .filter((p) => p.id);
    return snapshot;
  }
  async change(cwd: string, change: ExtensionChange, _requestId: string) {
    if (this.closed) throw new Error('Configuration client is closed');
    const path = await this.file(),
      content = await text(path);
    if (
      'sourceId' in change &&
      (change.sourceId !== hash(path) || change.version !== hash(content))
    )
      throw new Error('Configuration changed; refresh before saving');
    if (change.type === 'plugin') {
      if (!change.id.trim() || change.id.startsWith('-')) throw new Error('Invalid package');
      const args =
        this.provider === 'pi'
          ? [change.action === 'install' ? 'install' : 'remove', change.id, '--no-approve']
          : [
              'plugin',
              change.action === 'install'
                ? this.provider === 'grok'
                  ? 'install'
                  : 'add'
                : this.provider === 'grok'
                  ? 'uninstall'
                  : 'remove',
              change.id,
            ];
      if (this.provider === 'grok' && change.action === 'install') args.push('--trust');
      await this.run(args, cwd);
      return;
    }
    if (this.provider === 'grok') {
      if (change.type !== 'toggle' || change.name.startsWith('-'))
        throw new Error('Unsupported Grok operation');
      await this.run([change.category, change.enabled ? 'enable' : 'disable', change.name], cwd);
      return;
    }
    let next = content || '{}\n';
    const config = json(next);
    const set = (keys: string[], value: unknown) => {
      next = applyEdits(
        next,
        modify(next, keys, value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }),
      );
    };
    if (change.type === 'config') {
      if (change.key !== 'model') throw new Error('Unsupported setting');
      set([this.provider === 'pi' ? 'defaultModel' : 'model'], change.value);
    } else if (this.provider === 'opencode') {
      const legacy =
        ['plugin', 'permission', 'agent', 'command', 'snapshot', 'tools', 'provider'].some(
          (key) => key in config,
        ) ||
        Object.values(record(config.mcp)).some((value) =>
          ['local', 'remote'].includes(string(record(value).type)),
        );
      const prefix = 'servers' in record(config.mcp) || !legacy ? ['mcp', 'servers'] : ['mcp'];
      if (change.type === 'toggle') {
        if (
          change.category !== 'mcp' ||
          !record(record(config.mcp)[prefix.length === 2 ? 'servers' : change.name])[
            prefix.length === 2 ? change.name : 'type'
          ]
        )
          throw new Error('MCP server is no longer configured');
        set(
          [...prefix, change.name, prefix.length === 2 ? 'disabled' : 'enabled'],
          prefix.length === 2 ? !change.enabled : change.enabled,
        );
      } else {
        const server = change.server;
        const previous = record(
          prefix.length === 2
            ? record(record(config.mcp).servers)[change.name]
            : record(config.mcp)[change.name],
        );
        if (change.type === 'mcpAdd' && Object.keys(previous).length)
          throw new Error('Server already exists');
        if (change.type === 'mcpEdit' && !Object.keys(previous).length)
          throw new Error('Server no longer exists');
        const entry: Record<string, unknown> = { ...previous };
        if (server.transport === 'http') {
          entry.type = 'remote';
          entry.url = server.url;
          entry.headers = {
            ...record(previous.headers),
            ...Object.fromEntries(
              Object.entries(server.envHeaders || {}).map(([key, value]) => [
                key,
                `{env:${value}}`,
              ]),
            ),
          };
          if (server.bearerTokenEnvVar)
            record(entry.headers).Authorization = `Bearer {env:${server.bearerTokenEnvVar}}`;
        } else {
          entry.type = 'local';
          entry.command = [server.command, ...server.args];
          entry.environment = {
            ...record(previous.environment),
            ...Object.fromEntries(server.envVars.map((name) => [name, `{env:${name}}`])),
          };
        }
        if (change.type === 'mcpAdd')
          entry[prefix.length === 2 ? 'disabled' : 'enabled'] = prefix.length === 2;
        set([...prefix, change.name], entry);
      }
    } else throw new Error('Unsupported Pi operation');
    // Preserve comments and unrelated fields, reject external edits, replace atomically.
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(next);
        await file.sync();
      } finally {
        await file.close();
      }
      if ((await text(path)) !== content) throw new Error('Configuration changed while saving');
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  async login(
    _cwd: string,
    _name: string,
    _completed: (success: boolean) => void,
  ): Promise<string> {
    throw new Error('Use the provider CLI for authentication');
  }
  async close() {
    this.closed = true;
    await Promise.all([...this.children].map(terminate));
  }
}
