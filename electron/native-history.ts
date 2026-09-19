import { createHash, randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import type {
  ChildThread,
  NativeEntry,
  NativeOrigin,
  NativeThread,
} from '../shared/native-sessions';
import type { Message, Provider, Requests } from '../shared/types';
import { Store } from './db/store';
import type { AgentAdapter } from './providers/types';
import { providerDefinitions } from '../shared/providers';
import { RpcRejected } from './providers/rpc';
import type { NativeSessions } from './providers/native-types';

const nativeMethods = [
  'nativeCapabilities',
  'nativeList',
  'nativeRead',
  'nativeImport',
  'nativeFork',
  'nativeCompact',
  'childThreads',
  'childRead',
  'childControl',
] as const;
export type NativeMethod = (typeof nativeMethods)[number];
type Command = { [K in NativeMethod]: { method: K; args: Requests[K] } }[NativeMethod];
export function isNativeMethod(method: string): method is NativeMethod {
  return (nativeMethods as readonly string[]).includes(method);
}

type Hooks = {
  adapter(provider: Provider): Promise<AgentAdapter>;
  active(sessionId: string): AgentAdapter | undefined;
  lock(path: string): () => void;
  changed(): void;
};
type Operation = {
  sessionId: string;
  fingerprint: string;
  status: 'running' | 'done' | 'rejected' | 'unknown';
  result?: string;
  error?: string;
};

/** 原生读取和变更共用项目边界；变更意图落库后才调用底座，未知结果绝不自动重放。 */
export class NativeHistory {
  private adapters = new Set<AgentAdapter>();
  private pending = new Set<Promise<unknown>>();
  private stopped = false;
  constructor(
    private store: Store,
    private hooks: Hooks,
  ) {
    const unfinished = store.sqlite
      .prepare("SELECT key, value FROM settings WHERE key LIKE 'native-operation:%'")
      .all() as { key: string; value: string }[];
    for (const row of unfinished) {
      const operation = JSON.parse(row.value) as Operation;
      if (operation.status !== 'running') continue;
      const id = row.key.slice('native-operation:'.length);
      const message = store.message(id);
      const error = `${message?.text || ''}\nMoose restarted before this operation was confirmed. Result unknown; check native history before retrying.`;
      this.saveOperation(id, { ...operation, status: 'unknown', error });
      if (message)
        store.saveMessage({ ...message, seq: message.seq + 1, state: 'error', text: error });
    }
  }
  private async using<T>(provider: Provider, body: (native: NativeSessions) => Promise<T>) {
    const adapter = await this.hooks.adapter(provider);
    if (this.stopped) {
      await adapter.close();
      throw new Error('Moose is shutting down');
    }
    this.adapters.add(adapter);
    try {
      if (!adapter.sessions)
        throw new Error('This provider does not expose native session operations');
      return await body(adapter.sessions);
    } finally {
      await adapter.close();
      this.adapters.delete(adapter);
    }
  }
  private async scoped(native: NativeSessions, id: string, cwd: string) {
    const thread = await native.read(id, cwd);
    if ((await realpath(thread.cwd)) !== cwd)
      throw new Error('Native session belongs to a different project');
    return thread;
  }
  private operation(id: string, fingerprint: string): Operation | undefined {
    const row = this.store.sqlite
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(`native-operation:${id}`) as { value: string } | undefined;
    if (!row) {
      if (this.store.message(id)) throw new Error('Request ID is already used by another message');
      return;
    }
    const saved = JSON.parse(row.value) as Operation;
    if (saved.fingerprint !== fingerprint)
      throw new Error('Native operation request ID has already been used');
    return saved;
  }
  private saveOperation(id: string, operation: Operation) {
    this.store.sqlite
      .prepare(
        'INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(`native-operation:${id}`, JSON.stringify(operation));
  }
  private notice(sessionId: string, id: string, text: string, state: Message['state']) {
    const old = this.store.message(id);
    this.store.saveMessage({
      id,
      runId: id,
      sessionId,
      kind: 'notice',
      title: 'Native session',
      text,
      state,
      seq: (old?.seq || 0) + 1,
      createdAt: old?.createdAt || Date.now(),
    });
    this.hooks.changed();
  }
  private async collect(native: NativeSessions, id: string, cwd: string) {
    const items: NativeEntry[] = [],
      cursors = new Set<string>();
    let cursor: string | undefined,
      size = 0;
    do {
      const page = await native.items(id, cwd, cursor);
      items.push(...page.data);
      size += page.data.reduce((sum, row) => sum + row.text.length, 0);
      if (items.length > 10000 || size > 20_000_000)
        throw new Error('Native history exceeds the import limit');
      cursor = page.nextCursor || undefined;
      if (cursor && cursors.has(cursor)) throw new Error('Native history cursor did not advance');
      if (cursor) cursors.add(cursor);
      if (cursors.size > 1000) throw new Error('Native history has too many pages');
    } while (cursor);
    return items;
  }
  private persist(
    projectId: string,
    provider: Provider,
    thread: NativeThread,
    items: NativeEntry[],
    origin: NativeOrigin,
    mode = 'ask',
    worktreeId?: string | null,
  ) {
    return this.store.sqlite.transaction(() => {
      const existing = this.store
        .listSessions()
        .find((s) => s.provider === provider && s.nativeId === thread.id);
      if (existing) return existing;
      const session = this.store.createSession(projectId, provider);
      for (const [index, item] of items.entries())
        this.store.saveMessage({
          id: randomUUID(),
          runId: `${session.id}:${item.turnId || 'import'}`,
          sessionId: session.id,
          kind:
            item.kind === 'approval' || item.kind === 'question' || item.kind === 'plan'
              ? 'notice'
              : item.kind,
          text: item.text,
          title: item.title,
          delegation: item.delegation,
          nativeTurnId: item.turnId || undefined,
          state: 'done',
          seq: index + 1,
          createdAt: Date.now(),
        });
      return this.store.updateSession(session.id, {
        worktreeId,
        nativeId: thread.id,
        title: thread.title.slice(0, 160),
        model: thread.model,
        effort: thread.effort,
        mode,
        nativeOrigin: origin,
      });
    })();
  }
  children(sessionId: string): ChildThread[] {
    const session = this.store.session(sessionId),
      rows = new Map<string, ChildThread>();
    for (const message of this.store.allMessages(sessionId))
      for (const agent of message.delegation?.agents || []) {
        if (agent.id === session.nativeId) continue;
        rows.set(agent.id, {
          ...agent,
          parentId:
            rows.get(agent.id)?.parentId || message.sourceThreadId || session.nativeId || '',
          model: message.delegation?.model,
        });
      }
    return [...rows.values()];
  }
  async handle(method: NativeMethod, input: unknown): Promise<unknown> {
    const promise = this.dispatch({ method, args: input } as Command);
    this.pending.add(promise);
    try {
      return await promise;
    } finally {
      this.pending.delete(promise);
    }
  }
  private async dispatch(command: Command): Promise<unknown> {
    switch (command.method) {
      case 'nativeCapabilities':
        try {
          return await this.using(command.args.provider, (native) => native.capabilities());
        } catch (error) {
          return {
            history: false,
            fork: false,
            compact: false,
            children: false,
            reason: String(error),
          };
        }
      case 'childThreads':
        return this.children(command.args.sessionId);
      case 'nativeList':
      case 'nativeRead':
      case 'nativeImport':
        return this.browse(command);
      case 'childRead':
      case 'childControl':
        return this.child(command);
      case 'nativeFork':
      case 'nativeCompact':
        return this.mutate(command);
    }
  }
  private async browse(
    command: Extract<Command, { method: 'nativeList' | 'nativeRead' | 'nativeImport' }>,
  ) {
    const { method, args: a } = command;
    const cwd = this.store.directory(a.projectId, a.sessionId);
    const unlock = method === 'nativeImport' ? this.hooks.lock(cwd) : () => {};
    try {
      return await this.using(a.provider, async (native) => {
        if (method === 'nativeList') {
          const page = await native.list(cwd, a.cursor);
          const data: NativeThread[] = [];
          for (const thread of page.data)
            if (!thread.parentId && (await realpath(thread.cwd).catch(() => '')) === cwd)
              data.push(thread);
          return { ...page, data };
        }
        const thread = await this.scoped(native, a.nativeId, cwd);
        if (thread.parentId) throw new Error('Open child history from its parent conversation');
        if (method === 'nativeRead')
          return { thread, items: await native.items(thread.id, cwd, a.cursor) };
        const existing = this.store
          .listSessions()
          .find((s) => s.provider === a.provider && s.nativeId === thread.id);
        if (existing) {
          if (this.store.directory(existing.projectId, existing.id) !== cwd)
            throw new Error(
              'This native session is already linked to a different working directory',
            );
          return existing;
        }
        if (thread.status === 'active')
          throw new Error('Wait for the native session to finish before importing');
        const items = await this.collect(native, thread.id, cwd);
        const result = this.persist(
          a.projectId,
          a.provider,
          thread,
          items,
          {
            kind: 'import',
            sourceNativeId: thread.id,
            at: Date.now(),
          },
          'ask',
          a.sessionId ? this.store.session(a.sessionId).worktreeId : undefined,
        );
        this.hooks.changed();
        return result;
      });
    } finally {
      unlock();
    }
  }
  private async child(command: Extract<Command, { method: 'childRead' | 'childControl' }>) {
    const { method, args: a } = command;
    const session = this.store.session(a.sessionId),
      cwd = this.store.directory(session.projectId, session.id);
    if (!session.nativeId) throw new Error('This conversation has no native session yet');
    if (!this.children(session.id).some((child) => child.id === a.nativeId))
      throw new Error('Unknown child thread');
    const adapter = this.hooks.active(session.id);
    const read = async (native: NativeSessions) => {
      const thread = await this.scoped(native, a.nativeId, cwd);
      // Persisted delegation identifies descendants; verify its direct parent against that record.
      const child = this.children(session.id).find((item) => item.id === a.nativeId)!;
      if (thread.parentId !== child.parentId)
        throw new Error('Native child parent does not match this conversation');
      return {
        thread,
        items: await native.items(a.nativeId, cwd, 'cursor' in a ? a.cursor : undefined),
        controllable: !!adapter,
      };
    };
    if (method === 'childRead')
      return adapter?.sessions ? read(adapter.sessions) : this.using(session.provider, read);
    if (!this.store.getSettings()[providerDefinitions[session.provider].enabledKey])
      throw new Error('This provider is disabled in Settings');
    if (session.archived || !adapter?.sessions?.control)
      throw new Error(
        'Subagent controls require an active parent; ask the parent agent to continue this task',
      );
    await read(adapter.sessions);
    if (this.hooks.active(session.id) !== adapter) throw new Error('The parent task has ended');
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ method, ...a }))
      .digest('hex');
    if (this.operation(a.requestId, fingerprint))
      throw new Error('This control request was already submitted; refresh child history');
    this.saveOperation(a.requestId, { sessionId: session.id, fingerprint, status: 'running' });
    try {
      await adapter.sessions.control(a.nativeId, a.action, a.text);
      this.saveOperation(a.requestId, { sessionId: session.id, fingerprint, status: 'done' });
      this.notice(
        session.id,
        a.requestId,
        `${a.nativeId}: ${a.action} request accepted. Refresh native history to check the result.`,
        'done',
      );
    } catch (error) {
      this.saveOperation(a.requestId, {
        sessionId: session.id,
        fingerprint,
        status: error instanceof RpcRejected ? 'rejected' : 'unknown',
        error: String(error),
      });
      this.notice(
        session.id,
        a.requestId,
        `${a.nativeId}: ${String(error)}. ${error instanceof RpcRejected ? 'Request rejected.' : 'Result unknown; check native history before retrying.'}`,
        'error',
      );
      throw error;
    }
    return null;
  }
  private async mutate(command: Extract<Command, { method: 'nativeFork' | 'nativeCompact' }>) {
    const { method, args: a } = command;
    const session = this.store.session(a.sessionId),
      cwd = this.store.directory(session.projectId, session.id);
    if (!session.nativeId) throw new Error('This conversation has no native session yet');
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ method, ...a }))
      .digest('hex');
    const previous = this.operation(a.requestId, fingerprint);
    if (previous) {
      if (previous.status === 'done')
        return previous.result ? this.store.session(previous.result) : null;
      throw new Error(
        previous.error ||
          'Operation already submitted; result unknown. Check native history before retrying.',
      );
    }
    if (session.archived || this.store.queued(session.id).length)
      throw new Error('Use an idle, unarchived conversation with no queued messages');
    const unlock = this.hooks.lock(cwd);
    try {
      return await this.using(session.provider, async (native) => {
        const thread = await this.scoped(native, session.nativeId!, cwd);
        if (thread.status === 'active') throw new Error('Wait for the native turn to finish');
        if (method === 'nativeFork') {
          if (!native.fork) throw new Error('Native fork is unavailable');
          if (
            !this.store
              .allMessages(session.id)
              .some((m) => m.nativeTurnId === a.turnId && m.kind === 'user')
          )
            throw new Error('Choose a recorded native turn');
        } else if (!native.compact) throw new Error('Native compaction is unavailable');
        this.saveOperation(a.requestId, { sessionId: session.id, fingerprint, status: 'running' });
        this.notice(
          session.id,
          a.requestId,
          method === 'nativeFork' ? 'Forking native conversation…' : 'Compacting native context…',
          'running',
        );
        this.store.updateSession(session.id, { status: 'running' });
        this.hooks.changed();
        try {
          if (method === 'nativeFork') {
            const fork = await native.fork!(session, cwd, a.turnId);
            // Save the native ID before fetching history so a failed import is recoverable from the CLI list.
            this.notice(
              session.id,
              a.requestId,
              `Native fork created: ${fork.id}. Importing history…`,
              'running',
            );
            if ((await realpath(fork.cwd)) !== cwd)
              throw new Error('The native fork returned a different working directory');
            const items = await this.collect(native, fork.id, cwd);
            const result = this.persist(
              session.projectId,
              session.provider,
              fork,
              items,
              {
                kind: 'fork',
                sourceNativeId: session.nativeId!,
                sourceSessionId: session.id,
                forkTurnId: a.turnId,
                at: Date.now(),
              },
              session.mode,
              session.worktreeId,
            );
            this.saveOperation(a.requestId, {
              sessionId: session.id,
              fingerprint,
              status: 'done',
              result: result.id,
            });
            this.notice(
              session.id,
              a.requestId,
              `Native fork: ${fork.id} · checkpoint: ${a.turnId}`,
              'done',
            );
            return result;
          }
          await native.compact!(session, cwd);
          this.saveOperation(a.requestId, { sessionId: session.id, fingerprint, status: 'done' });
          this.notice(session.id, a.requestId, 'Native context compaction completed.', 'done');
          return null;
        } catch (error) {
          const text = `${this.store.message(a.requestId)?.text || ''}\n${String(error)}. ${error instanceof RpcRejected ? 'Request rejected.' : 'Result unknown; check native history before retrying.'}`;
          this.saveOperation(a.requestId, {
            sessionId: session.id,
            fingerprint,
            status: error instanceof RpcRejected ? 'rejected' : 'unknown',
            error: text,
          });
          this.notice(session.id, a.requestId, text, 'error');
          throw error;
        } finally {
          this.store.updateSession(session.id, { status: session.status });
          this.hooks.changed();
        }
      });
    } finally {
      unlock();
    }
  }
  async close() {
    this.stopped = true;
    await Promise.allSettled([...this.adapters].map((adapter) => adapter.close()));
    await Promise.allSettled(this.pending);
  }
}
