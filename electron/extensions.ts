import { UserExtensions } from './providers/user-extensions';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import type { Store } from './db/store';
import { CodexExtensions } from './providers/codex-extensions';
import type {
  ExtensionScope,
  ExtensionAuth,
  ExtensionChange,
  ExtensionSnapshot,
} from '../shared/extensions';
import type { Requests } from '../shared/types';

type Method = 'extensionsRead' | 'extensionsChange' | 'extensionsLogin' | 'extensionsAuth';
export const isExtensionMethod = (method: string): method is Method =>
  ['extensionsRead', 'extensionsChange', 'extensionsLogin', 'extensionsAuth'].includes(method);
type Command = { [K in Method]: { method: K; args: Requests[K] } }[Method];
interface Receipt {
  fingerprint: string;
  status: 'running' | 'done' | 'unknown';
  projectId?: string;
}
interface AuthRun {
  state: ExtensionAuth;
  client: CodexExtensions | UserExtensions;
  timer: ReturnType<typeof setTimeout>;
}
/** Configuration mutations are serialized across workspaces; OAuth URLs exist in memory only. */
export class Extensions {
  private clients = new Set<CodexExtensions | UserExtensions>();
  private pending = new Set<Promise<unknown>>();
  private auth = new Map<string, AuthRun>();
  private stopped = false;
  private startingAuth = false;
  constructor(
    private store: Store,
    private hooks: { path(scope: ExtensionScope): Promise<string>; lock(): () => void },
    private factory = (path: string) => new CodexExtensions(path),
  ) {
    const rows = store.sqlite
      .prepare("SELECT key,value FROM settings WHERE key LIKE 'extension-operation:%'")
      .all() as { key: string; value: string }[];
    for (const row of rows) {
      const receipt = JSON.parse(row.value) as Receipt;
      if (receipt.status === 'running') this.save(row.key, { ...receipt, status: 'unknown' });
    }
  }
  private save(key: string, value: Receipt) {
    this.store.sqlite
      .prepare(
        'INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, JSON.stringify(value));
  }
  handle(method: Method, args: unknown) {
    const task = this.dispatch({ method, args } as Command);
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task)).catch(() => {});
    return task;
  }
  private async client(scope: ExtensionScope) {
    const path = await this.hooks.path(scope);
    const client =
      scope.provider === 'codex' ? this.factory(path) : new UserExtensions(path, scope.provider);
    if (this.stopped) {
      await client.close();
      throw new Error('Moose is shutting down');
    }
    this.clients.add(client);
    return client;
  }
  private async closeClient(client: CodexExtensions | UserExtensions) {
    await client.close();
    this.clients.delete(client);
  }
  private async read(scope: ExtensionScope, cwd: string) {
    const client = await this.client(scope);
    try {
      return await client.read(cwd);
    } catch {
      throw new Error(
        'Configuration lookup failed. Check the provider CLI; raw errors are hidden to protect credentials.',
      );
    } finally {
      await this.closeClient(client);
    }
  }
  private async finishAuth(id: string, status: ExtensionAuth['status']) {
    const run = this.auth.get(id);
    if (!run || run.state.status !== 'pending') return;
    run.state.status = status;
    clearTimeout(run.timer);
    await this.closeClient(run.client);
  }
  private async dispatch(command: Command): Promise<unknown> {
    if (this.stopped) throw new Error('Moose is shutting down');
    if (command.method === 'extensionsAuth') {
      const run = this.auth.get(command.args.id);
      if (!run) throw new Error('Authentication expired. Start a new login.');
      if (command.args.cancel) await this.finishAuth(run.state.id, 'cancelled');
      return run.state;
    }
    const scope = command.args,
      cwd = scope.projectId ? this.store.directory(scope.projectId, scope.sessionId) : homedir();
    if (!scope.projectId && scope.sessionId) throw new Error('A session requires a project');
    if (command.method === 'extensionsRead') return this.read(scope, cwd);
    if (command.method === 'extensionsLogin') {
      if (this.auth.size >= 100)
        for (const [id, run] of this.auth) {
          if (run.state.status !== 'pending') this.auth.delete(id);
        }
      if (this.auth.has(command.args.requestId))
        throw new Error('Authentication already started. Check its status.');
      if (
        this.startingAuth ||
        [...this.auth.values()].some((run) => run.state.status === 'pending')
      )
        throw new Error('Finish or cancel the pending authentication first');
      this.startingAuth = true;
      let client: CodexExtensions | UserExtensions;
      try {
        client = await this.client(scope);
      } finally {
        this.startingAuth = false;
      }
      const id = command.args.requestId;
      const state: ExtensionAuth = { id, name: command.args.name, status: 'pending' };
      const timer = setTimeout(() => void this.finishAuth(id, 'expired').catch(() => {}), 65000);
      timer.unref();
      this.auth.set(id, { state, client, timer });
      let starting = true;
      let completed: boolean | undefined;
      try {
        const snapshot = await client.read(cwd);
        if (!snapshot.mcp.some((server) => server.name === state.name && server.enabled))
          throw new Error('MCP server unavailable');
        const url = await client.login(cwd, state.name, (success) => {
          if (starting) completed = success;
          else void this.finishAuth(id, success ? 'completed' : 'failed').catch(() => {});
        });
        starting = false;
        if (completed !== undefined) await this.finishAuth(id, completed ? 'completed' : 'failed');
        return { ...state, url };
      } catch {
        await this.finishAuth(id, 'failed');
        throw new Error(
          'MCP authentication could not start. Refresh its status in the provider CLI.',
        );
      }
    }
    const unlock = this.hooks.lock();
    try {
      const key = `extension-operation:${command.args.requestId}`,
        fingerprint = createHash('sha256').update(JSON.stringify(command.args)).digest('hex');
      const row = this.store.sqlite.prepare('SELECT value FROM settings WHERE key=?').get(key) as
        | { value: string }
        | undefined;
      if (row) {
        const receipt = JSON.parse(row.value) as Receipt;
        if (receipt.fingerprint !== fingerprint) throw new Error('Request ID already used');
        if (receipt.status === 'done') return await this.read(scope, cwd);
        throw new Error('Previous result is unconfirmed. Refresh before another explicit change.');
      }
      const receipt: Receipt = { fingerprint, status: 'running', projectId: scope.projectId };
      this.save(key, receipt);
      let confirmed = false;
      try {
        const client = await this.client(scope);
        let result: ExtensionSnapshot;
        try {
          await client.change(cwd, command.args.change, command.args.requestId);
          confirmed = true;
          this.save(key, { ...receipt, status: 'done' });
          const quick =
            command.args.change.type === 'config' ||
            (command.args.change.type === 'toggle' && command.args.change.category === 'mcp');
          result =
            client instanceof CodexExtensions
              ? await client.read(cwd, quick)
              : await client.read(cwd);
        } finally {
          await this.closeClient(client);
        }
        if (!this.effective(result, command.args.change) && scope.provider !== 'codex')
          throw new Error('The native operation did not produce the requested configuration');
        if (!this.effective(result, command.args.change))
          result.diagnostics.push({
            area: 'write',
            message:
              'Native write completed, but the effective state differs. A higher-priority configuration or provider policy may override it.',
          });
        return result;
      } catch {
        if (!confirmed) this.save(key, { ...receipt, status: 'unknown' });
        throw new Error(
          'Configuration change was not fully verified. Refresh before retrying; raw provider errors are hidden to protect credentials.',
        );
      }
    } finally {
      unlock();
    }
  }
  private effective(snapshot: ExtensionSnapshot, change: ExtensionChange) {
    if (change.type === 'mcpEdit') return snapshot.mcp.some((s) => s.name === change.name);
    if (change.type === 'mcpAdd')
      return snapshot.mcp.some((s) => s.name === change.name && !s.enabled);
    if (change.type === 'config')
      return snapshot.settings.some((s) => s.key === change.key && s.value === change.value);
    if (change.type === 'plugin')
      return change.action === 'install'
        ? snapshot.plugins.some(
            (p) => (p.id === change.id || p.installedFrom === change.id) && p.installed,
          )
        : !snapshot.plugins.some(
            (p) => (p.id === change.id || p.installedFrom === change.id) && p.installed,
          );
    return change.category === 'mcp'
      ? snapshot.mcp.some((s) => s.name === change.name && s.enabled === change.enabled)
      : snapshot.plugins.some((p) => p.id === change.name && p.enabled === change.enabled);
  }
  async close() {
    this.stopped = true;
    await Promise.all([...this.auth.keys()].map((id) => this.finishAuth(id, 'cancelled')));
    await Promise.all([...this.clients].map((c) => this.closeClient(c)));
    await Promise.allSettled(this.pending);
  }
}
