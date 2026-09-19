import type { NativeEntry, NativePage, NativeThread } from '../../shared/native-sessions';
import type { NativeSessions } from './native-types';
import { JsonRpc } from './rpc';
import { array, record, string, readable } from './types';

/** ACP list/load 回放，不发送 prompt；没有原生 fork/compact 协议时明确不提供。 */
export class GrokSessions implements NativeSessions {
  private rpc?: JsonRpc;
  private ready?: Promise<JsonRpc>;
  private supported = false;
  private replay?: {
    id: string;
    items: NativeEntry[];
    kind: string;
    serial: number;
    error?: string;
  };
  private cache?: { id: string; cwd: string; items: NativeEntry[] };
  constructor(private path: string) {}
  private connect() {
    return (this.ready ||= (async () => {
      const rpc = (this.rpc = new JsonRpc(this.path, ['agent', '--no-leader', 'stdio']));
      rpc.onRequest = (id) =>
        rpc.send({
          id,
          error: { code: -32601, message: 'History browsing cannot approve tool execution' },
        });
      rpc.onNotification = (method, params) => {
        const p = record(params),
          update = record(p.update),
          replay = this.replay;
        if (method !== 'session/update' || !replay || p.sessionId !== replay.id) return;
        const kind = string(update.sessionUpdate);
        if (replay.error) return;
        if (kind === 'tool_call' || kind === 'tool_call_update') {
          replay.kind = '';
          const id = `tool:${string(update.toolCallId)}`;
          let row = replay.items.find((item) => item.id === id);
          if (!row) {
            row = { id, turnId: '', kind: 'tool', title: '', text: '' };
            replay.items.push(row);
          }
          if (typeof update.title === 'string') row.title = update.title;
          if (
            update.content !== undefined ||
            update.rawOutput !== undefined ||
            update.rawInput !== undefined
          )
            row.text = readable(update.content ?? update.rawOutput ?? update.rawInput);
          if (row.text.length > 500000 || replay.items.length > 10000)
            replay.error = 'Native history exceeds the import limit';
          return;
        }
        if (!['user_message_chunk', 'agent_message_chunk', 'agent_thought_chunk'].includes(kind))
          return;
        const content = record(update.content);
        const role =
          kind === 'user_message_chunk'
            ? 'user'
            : kind === 'agent_thought_chunk'
              ? 'reasoning'
              : 'assistant';
        if (replay.kind !== kind) {
          replay.items.push({
            id: `replay-${++replay.serial}`,
            turnId: '',
            kind: role,
            title: '',
            text: '',
          });
          replay.kind = kind;
        }
        const row = replay.items.at(-1)!;
        row.text +=
          content.type === 'text'
            ? string(content.text)
            : `[${string(content.type) || 'attachment'}]`;
        if (row.text.length > 500000 || replay.items.length > 10000)
          replay.error = 'Native history exceeds the import limit';
      };
      const init = record(
        await rpc.request('initialize', {
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
        }),
      );
      const caps = record(init.agentCapabilities);
      this.supported =
        caps.loadSession === true && Object.hasOwn(record(caps.sessionCapabilities), 'list');
      if (array(init.authMethods).some((method) => record(method).id === 'cached_token'))
        await rpc.request('authenticate', { methodId: 'cached_token' });
      return rpc;
    })());
  }
  async capabilities() {
    await this.connect();
    return {
      history: this.supported,
      fork: false,
      compact: false,
      children: false,
      reason: this.supported
        ? 'Grok ACP supports history replay; native fork, compaction and structured subagent controls are unavailable.'
        : 'This Grok ACP version does not advertise list and load capabilities.',
    };
  }
  async list(cwd: string, cursor?: string): Promise<NativePage<NativeThread>> {
    const rpc = await this.connect();
    if (!this.supported) throw new Error('Native history is unavailable in this Grok version');
    const result = record(await rpc.request('session/list', { cwd, cursor }));
    return {
      nextCursor: string(result.nextCursor) || null,
      data: array(result.sessions).map((value) => {
        const s = record(value);
        return {
          id: string(s.sessionId),
          cwd: string(s.cwd),
          title: string(s.title) || string(s.sessionId),
          updatedAt: Date.parse(string(s.updatedAt)) || 0,
          parentId: null,
          forkedFromId: null,
          status: 'unknown',
          model: '',
          effort: '',
          canAcceptInput: false,
        };
      }),
    };
  }
  async read(id: string, cwd: string) {
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const page = await this.list(cwd, cursor);
      const thread = page.data.find((item) => item.id === id);
      if (thread) return thread;
      cursor = page.nextCursor || undefined;
      if (cursor && seen.has(cursor)) throw new Error('Native history cursor did not advance');
      if (cursor) seen.add(cursor);
    } while (cursor && seen.size < 250);
    throw new Error('Native session was not found in this project');
  }
  async items(id: string, cwd: string, cursor?: string): Promise<NativePage<NativeEntry>> {
    const rpc = await this.connect();
    if (!this.cache || this.cache.id !== id || this.cache.cwd !== cwd) {
      await this.read(id, cwd);
      const replay: NonNullable<GrokSessions['replay']> = { id, items: [], kind: '', serial: 0 };
      this.replay = replay;
      try {
        await rpc.request('session/load', { sessionId: id, cwd, mcpServers: [] });
      } finally {
        this.replay = undefined;
      }
      if (replay.error) throw new Error(replay.error);
      this.cache = { id, cwd, items: replay.items };
    }
    const offset = cursor ? Number(cursor) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid history cursor');
    return {
      data: this.cache.items.slice(offset, offset + 40),
      nextCursor: offset + 40 < this.cache.items.length ? String(offset + 40) : null,
    };
  }
  async close() {
    await this.rpc?.close();
  }
}
