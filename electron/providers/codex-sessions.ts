import type { NativeEntry, NativePage, NativeThread } from '../../shared/native-sessions';
import type { Session } from '../../shared/types';
import type { NativeSessions } from './native-types';
import { codexPermissions } from './codex-permissions';
import { array, record, string, readable, type AgentEvent } from './types';
import { JsonRpc, RpcRejected } from './rpc';
import type { Thread } from './generated/codex/v2/Thread';
import type { ThreadItemsListResponse } from './generated/codex/v2/ThreadItemsListResponse';
import type { ThreadListResponse } from './generated/codex/v2/ThreadListResponse';
import type { ThreadTurnsListResponse } from './generated/codex/v2/ThreadTurnsListResponse';

export function codexThread(thread: Thread): NativeThread {
  const source = record(record(record(thread.source).subagent).thread_spawn);
  return {
    id: thread.id,
    title: thread.name || thread.preview || thread.id,
    cwd: thread.cwd,
    updatedAt: thread.updatedAt * 1000,
    parentId: thread.parentThreadId || string(source.parent_thread_id) || null,
    forkedFromId: thread.forkedFromId || null,
    status: thread.status?.type === 'systemError' ? 'error' : thread.status?.type || 'unknown',
    model: thread.model || '',
    effort: thread.reasoningEffort || '',
    canAcceptInput: thread.canAcceptDirectInput === true,
  };
}

/** 使用同一 app-server 的原生历史接口；压缩等到完成事件，不把 RPC 回执当作完成。 */
export class CodexSessions implements NativeSessions {
  private supported = false;
  private userAgent = '';
  handshake(userAgent: string) {
    this.userAgent = userAgent;
    const match = userAgent.match(/\/(\d+)\.(\d+)\.(\d+)/);
    this.supported = !!match && (Number(match[1]) > 0 || Number(match[2]) >= 155);
  }
  private async connection() {
    const rpc = await this.connect();
    if (!this.supported)
      throw new RpcRejected('Native session operations require the verified Codex 0.155+ protocol');
    return rpc;
  }
  private compactions = new Map<
    string,
    { turnId: string; sawItem: boolean; resolve(): void; reject(error: Error): void }
  >();
  constructor(
    private connect: () => Promise<JsonRpc>,
    private normalize: (method: string, input: unknown) => AgentEvent | null,
  ) {}
  async capabilities() {
    await this.connect();
    return {
      history: this.supported,
      fork: this.supported,
      compact: this.supported,
      children: this.supported,
      ...(!this.supported
        ? {
            reason: `Native session operations require Codex 0.155+. Detected: ${this.userAgent || 'unknown version'}`,
          }
        : {}),
    };
  }
  async list(cwd: string, cursor?: string): Promise<NativePage<NativeThread>> {
    const rpc = await this.connection();
    const result = await rpc.request<ThreadListResponse>('thread/list', {
      cwd,
      cursor,
      limit: 40,
      sortKey: 'updated_at',
      modelProviders: [],
      sourceKinds: ['cli', 'vscode', 'exec', 'appServer'],
    });
    return { data: result.data.map(codexThread), nextCursor: result.nextCursor };
  }
  async read(id: string): Promise<NativeThread> {
    const result = await (
      await this.connection()
    ).request<{ thread: Thread }>('thread/read', { threadId: id, includeTurns: false });
    return codexThread(result.thread);
  }
  async items(id: string, _cwd: string, cursor?: string): Promise<NativePage<NativeEntry>> {
    const result = await (
      await this.connection()
    ).request<ThreadItemsListResponse>('thread/items/list', {
      threadId: id,
      cursor,
      limit: 40,
      sortDirection: 'asc',
    });
    return {
      nextCursor: result.nextCursor,
      data: result.data.map(({ item, turnId }) => {
        const raw = record(item);
        const event = this.normalize('item/completed', { item });
        return {
          id: item.id,
          turnId,
          delegation: event?.delegation,
          kind:
            item.type === 'userMessage'
              ? 'user'
              : event?.kind === 'plan'
                ? 'assistant'
                : event?.kind || 'notice',
          title: event?.title || '',
          text:
            item.type === 'userMessage'
              ? array(raw.content)
                  .map((c) => string(record(c).text) || `[${string(record(c).type)}]`)
                  .join('\n')
              : event?.text || readable(raw.output || raw.text || ''),
        };
      }),
    };
  }
  async fork(session: Session, cwd: string, lastTurnId: string) {
    const result = await (
      await this.connection()
    ).request<{ thread: Thread }>('thread/fork', {
      threadId: session.nativeId,
      lastTurnId,
      cwd,
      ...codexPermissions(session.mode),
      excludeTurns: true,
      deferGoalContinuation: true,
    });
    return codexThread(result.thread);
  }
  async compact(session: Session, cwd: string) {
    const id = session.nativeId!;
    const rpc = await this.connection();
    const thread = await this.read(id);
    if (thread.status === 'active') throw new RpcRejected('Wait for the native turn to finish');
    const goal = record(await rpc.request('thread/goal/get', { threadId: id })).goal;
    if (record(goal).status === 'active')
      throw new RpcRejected('Pause the active native goal before compacting this conversation');
    await rpc.request('thread/resume', {
      threadId: id,
      cwd,
      ...codexPermissions(session.mode),
      excludeTurns: true,
    });
    if (this.compactions.has(id)) throw new RpcRejected('Compaction is already running');
    let timer: ReturnType<typeof setTimeout>;
    const done = new Promise<void>((resolve, reject) => {
      this.compactions.set(id, { turnId: '', sawItem: false, resolve, reject });
      timer = setTimeout(
        () =>
          reject(
            new Error(
              'Compaction result unknown: timed out. Check native history before retrying.',
            ),
          ),
        120000,
      );
    });
    void done.catch(() => {});
    try {
      await rpc.request('thread/compact/start', { threadId: id });
      await done;
    } finally {
      clearTimeout(timer!);
      this.compactions.delete(id);
    }
  }
  notification(method: string, p: Record<string, unknown>) {
    const pending = this.compactions.get(string(p.threadId));
    if (!pending) return;
    const turn = record(p.turn);
    if (method === 'turn/started') pending.turnId = string(turn.id);
    if (method === 'item/completed' && record(p.item).type === 'contextCompaction')
      pending.sawItem = true;
    if (method === 'turn/completed' && (!pending.turnId || pending.turnId === turn.id)) {
      if (turn.status === 'completed' && pending.sawItem) pending.resolve();
      else
        pending.reject(
          new RpcRejected(string(record(turn.error).message) || 'Compaction did not complete'),
        );
    }
  }
  disconnected(error: Error) {
    for (const pending of this.compactions.values()) pending.reject(error);
  }
  async control(id: string, action: 'send' | 'stop' | 'resume', text?: string) {
    const rpc = await this.connection();
    const thread = await this.read(id);
    if (action === 'resume')
      throw new RpcRejected(
        'This protocol can reload a thread but cannot resume a closed subagent task. Ask the parent agent to resume it.',
      );
    const turns = await rpc.request<ThreadTurnsListResponse>('thread/turns/list', {
      threadId: id,
      limit: 1,
      sortDirection: 'desc',
    });
    const active = turns.data.find((turn) => turn.status === 'inProgress');
    if (action === 'stop') {
      if (!active) throw new RpcRejected('This subagent has no active turn');
      await rpc.request('turn/interrupt', { threadId: id, turnId: active.id });
      return;
    }
    if (!thread.canAcceptInput)
      throw new RpcRejected(
        'Direct input is unavailable for this subagent; send instructions to the parent agent.',
      );
    if (!text?.trim()) throw new RpcRejected('Enter a subagent message');
    const input = [{ type: 'text', text, text_elements: [] }];
    await rpc.request(active ? 'turn/steer' : 'turn/start', {
      threadId: id,
      input,
      ...(active ? { expectedTurnId: active.id } : {}),
    });
  }
}
