import { mcpConfig } from '../../shared/mcp-registration';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { JsonRpc, RpcRejected } from './rpc';
import { record, string } from './types';
import type { ConfigReadResponse } from './generated/codex/v2/ConfigReadResponse';
import { CodexPlugins } from './codex-plugins';
import type { ListMcpServerStatusResponse } from './generated/codex/v2/ListMcpServerStatusResponse';
import type { HooksListResponse } from './generated/codex/v2/HooksListResponse';
import type { ExtensionChange, ExtensionSnapshot, ConfigSource } from '../../shared/extensions';

function sourceId(layer: ConfigReadResponse['origins'][string]) {
  return layer ? createHash('sha256').update(JSON.stringify(layer.name)).digest('hex') : '';
}
function sources(config: ConfigReadResponse): ConfigSource[] {
  return (config.layers || []).map((layer) => {
    const name = layer.name;
    return {
      id: sourceId(layer),
      kind: name.type,
      path:
        'file' in name
          ? name.file
          : name.type === 'project'
            ? join(name.dotCodexFolder, 'config.toml')
            : '',
      version: layer.version,
      writable: !layer.disabledReason && name.type === 'user' && !name.profile,
      disabled: !!layer.disabledReason,
    };
  });
}
/** Raw config, commands, headers and backend errors never cross the renderer boundary. */
export class CodexExtensions {
  private closed = false;
  private rpc?: JsonRpc;
  private version = '';
  private cwd = '';
  private completed?: (success: boolean) => void;
  private authName = '';
  private plugins: CodexPlugins;
  constructor(private path: string) {
    this.plugins = new CodexPlugins(path);
  }
  async connect(cwd: string) {
    if (this.closed) throw new Error('Configuration client is closed');
    if (this.rpc) {
      if (this.cwd !== cwd) throw new Error('Configuration directory changed');
      return this.rpc;
    }
    this.cwd = cwd;
    const rpc = (this.rpc = new JsonRpc(this.path, ['app-server'], cwd));
    rpc.onRequest = (id) =>
      rpc.send({
        id,
        error: { code: -32601, message: 'Configuration management cannot approve tool execution' },
      });
    rpc.onNotification = (method, value) => {
      const params = record(value);
      if (method === 'mcpServer/oauthLogin/completed' && params.name === this.authName)
        this.completed?.(params.success === true);
    };
    rpc.onExit = () => this.completed?.(false);
    const init = record(
      await rpc.request('initialize', {
        clientInfo: { name: 'moose', version: '0.10.0' },
        capabilities: { experimentalApi: true },
      }),
    );
    this.version = string(init.userAgent);
    rpc.send({ method: 'initialized', params: {} });
    const match = this.version.match(/\/(\d+)\.(\d+)\./);
    if (!match || (Number(match[1]) === 0 && Number(match[2]) < 155))
      throw new RpcRejected('Configuration management requires Codex 0.155+');
    return rpc;
  }
  async read(cwd: string): Promise<ExtensionSnapshot> {
    const rpc = await this.connect(cwd);
    const snapshot: ExtensionSnapshot = {
      supported: true,
      version: this.version,
      cwd,
      sources: [],
      settings: [],
      mcp: [],
      plugins: [],
      hooks: [],
      diagnostics: [],
    };
    const results = await Promise.allSettled([
      rpc.request<ConfigReadResponse>('config/read', { cwd, includeLayers: true }),
      this.plugins.list(cwd),
      rpc.request<HooksListResponse>('hooks/list', { cwds: [cwd] }),
    ]);
    const [config, plugins, hooks] = results;
    for (const [i, result] of results.entries())
      if (result.status === 'rejected')
        snapshot.diagnostics.push({
          area: ['config', 'plugins', 'hooks'][i],
          message: 'Native lookup failed. Inspect this configuration using the provider CLI.',
        });
    if (config.status === 'fulfilled') {
      snapshot.sources = sources(config.value);
      for (const key of ['model', 'model_reasoning_effort', 'approval_policy', 'sandbox_mode']) {
        const value = config.value.config[key];
        if (typeof value === 'string')
          snapshot.settings.push({ key, value, source: sourceId(config.value.origins[key]) });
      }
      const servers = record(config.value.config.mcp_servers);
      snapshot.mcp = Object.entries(servers).map(([name, value]) => ({
        name,
        enabled: record(value).enabled !== false,
        auth: 'unknown',
        tools: 0,
        failed: false,
      }));
      for (const layer of snapshot.sources)
        if (layer.disabled)
          snapshot.diagnostics.push({
            area: 'config',
            path: layer.path,
            message: 'This configuration layer is disabled by the provider.',
          });
    }
    if (plugins.status === 'fulfilled') snapshot.plugins = plugins.value;
    if (hooks.status === 'fulfilled')
      for (const entry of hooks.value.data) {
        snapshot.hooks.push(
          ...entry.hooks.map((h) => ({
            key: h.key,
            event: h.eventName,
            source: h.sourcePath,
            enabled: h.enabled,
            handler: h.handlerType,
          })),
        );
        snapshot.diagnostics.push(
          ...entry.errors.map((e) => ({
            area: 'hooks',
            path: e.path,
            message: 'Hook configuration could not be loaded.',
          })),
          ...entry.warnings.map(() => ({
            area: 'hooks',
            path: entry.cwd,
            message: 'The provider reported a hook warning. Check it in the CLI.',
          })),
        );
      }
    try {
      let cursor: string | null = null;
      const seen = new Set<string>();
      for (let page = 0; page < 50; page++) {
        const result: ListMcpServerStatusResponse = await rpc.request('mcpServerStatus/list', {
          cursor,
          limit: 100,
          detail: 'toolsAndAuthOnly',
        });
        for (const server of result.data) {
          const row = snapshot.mcp.find((s) => s.name === server.name);
          const status = {
            name: server.name,
            enabled: row?.enabled ?? true,
            auth: server.authStatus,
            tools: Object.keys(server.tools).length,
            failed: !!server.toolsError,
          };
          if (row) Object.assign(row, status);
          else snapshot.mcp.push(status);
        }
        cursor = result.nextCursor;
        if (!cursor) break;
        if (seen.has(cursor) || page === 49) throw new Error('Pagination limit');
        seen.add(cursor);
      }
    } catch {
      snapshot.diagnostics.push({
        area: 'mcp',
        message: 'MCP discovery is incomplete; configuration entries are still shown.',
      });
    }
    return snapshot;
  }
  async change(cwd: string, change: ExtensionChange, _requestId: string) {
    const rpc = await this.connect(cwd);
    if (change.type === 'plugin') {
      await this.plugins.change(cwd, change.id, change.action);
      return;
    }
    const config = await rpc.request<ConfigReadResponse>('config/read', {
      cwd,
      includeLayers: true,
    });
    const source = sources(config).find((s) => s.id === change.sourceId && s.writable);
    if (!source || source.version !== change.version)
      throw new RpcRejected('Configuration changed or is read-only. Refresh before saving.');
    if (change.type === 'mcpAdd') {
      if (
        Object.hasOwn(record(config.config.mcp_servers), change.name) ||
        (config.layers || []).some((layer) =>
          Object.hasOwn(record(record(layer.config).mcp_servers), change.name),
        )
      )
        throw new RpcRejected('This MCP name already exists in a configuration layer');
      await rpc.request('config/value/write', {
        keyPath: `mcp_servers.${JSON.stringify(change.name)}`,
        value: mcpConfig(change.server),
        mergeStrategy: 'replace',
        filePath: source.path,
        expectedVersion: source.version,
      });
      return;
    }
    let keyPath: string, value: string | boolean;
    if (change.type === 'config') {
      keyPath = change.key;
      value = change.value;
    } else {
      if (
        change.category === 'mcp' &&
        !Object.hasOwn(record(config.config.mcp_servers), change.name)
      )
        throw new RpcRejected('This MCP server is not in the effective configuration');
      if (change.category === 'plugin') {
        const catalog = await this.plugins.list(cwd);
        if (!catalog.some((p) => p.id === change.name && p.installed))
          throw new RpcRejected('This plugin is not installed');
      }
      keyPath = `${change.category === 'mcp' ? 'mcp_servers' : 'plugins'}.${JSON.stringify(change.name)}.enabled`;
      value = change.enabled;
    }
    await rpc.request('config/value/write', {
      keyPath,
      value,
      mergeStrategy: 'replace',
      filePath: source.path,
      expectedVersion: source.version,
    });
  }
  async login(cwd: string, name: string, completed: (success: boolean) => void) {
    const rpc = await this.connect(cwd);
    this.authName = name;
    this.completed = completed;
    const result = await rpc.request<{ authorizationUrl: string }>('mcpServer/oauth/login', {
      name,
      timeoutSecs: 60,
    });
    const url = new URL(result.authorizationUrl);
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new Error('Unsafe authorization URL');
    return url.href;
  }
  async close() {
    this.closed = true;
    this.completed = undefined;
    await Promise.all([this.rpc?.close(), this.plugins.close()]);
  }
}
