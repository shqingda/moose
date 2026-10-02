import { randomUUID } from 'node:crypto';
import { Store } from './db/store';
import { providerDefinitions } from '../shared/providers';
import { fault } from '../shared/errors';
import { pendingMessage } from './experience-data';
import { createAdapter } from './providers/registry';
import { providerError, type AgentAdapter, type AgentEvent } from './providers/types';
import type { AppEvent, Message, Provider, Session } from '../shared/types';
import type { TaskNotice } from '../shared/experience';
import { Attachments, agentAttachments } from './attachments';
import type { Background } from './background';
import type { Worktrees } from './worktrees';
import type { ContextCatalog } from './context-catalog';

export type Active = {
  id: string;
  session: Session;
  adapter: AgentAdapter;
  seq: number;
  cancelled: boolean;
  rows: Map<string, Omit<Message, 'position'>>;
  dirty: Set<string>;
  promise?: Promise<void>;
};
type ExecutionHooks = {
  configuring(): boolean;
  stopping(): boolean;
  directoryBusy(path: string): boolean;
  providerPath(provider: Provider): Promise<string>;
  changed(): void;
  emit(event: AppEvent): void;
  notice(session: Session, kind: TaskNotice['kind'], id: string, messageId?: string): void;
};
/** Serializes each directory's queue and batches agent events into the shared store. */
export class SessionExecution {
  readonly active = new Map<string, Active>();
  readonly paused = new Set<string>();
  private flushTimer: ReturnType<typeof setInterval>;
  constructor(
    private store: Store,
    private attachments: Attachments,
    private catalog: ContextCatalog,
    private worktrees: Worktrees,
    private background: Background,
    private hooks: ExecutionHooks,
    private adapterFactory = createAdapter,
  ) {
    for (const item of store.queued()) this.paused.add(item.sessionId);
    this.flushTimer = setInterval(() => this.flush(), 80);
  }
  private draining = false;
  private drainAgain = false;
  private drainIdle: (() => void)[] = [];
  /** 按入队顺序启动可执行任务；同目录串行，不同目录可并行。 */
  async drain() {
    if (this.hooks.configuring()) return;
    if (this.hooks.stopping()) return;
    if (this.draining) {
      this.drainAgain = true;
      return;
    }
    this.draining = true;
    try {
      for (const item of this.store.queued()) {
        if (this.hooks.stopping() || this.paused.has(item.sessionId)) continue;
        const session = this.store.listSessions().find((s) => s.id === item.sessionId);
        if (!session || !this.store.getSettings()[providerDefinitions[session.provider].enabledKey])
          continue;
        const location = this.store.sessionPath(session);
        if (
          session.archived ||
          this.active.has(location) ||
          this.hooks.directoryBusy(location) ||
          this.worktrees.blocks(location)
        )
          continue;
        let path: string, cwd: string;
        try {
          cwd = await this.worktrees.ensure(session);
          path = await this.hooks.providerPath(session.provider);
        } catch (error) {
          if (this.hooks.stopping()) break;
          this.paused.add(session.id);
          this.background.schedules.failedToStart(item.id);
          this.store.updateSession(session.id, { status: 'failed' });
          this.store.saveMessage({
            id: randomUUID(),
            runId: randomUUID(),
            sessionId: session.id,
            seq: 1,
            kind: 'error',
            failure: fault(error),
            text: error instanceof Error ? error.message : String(error),
            title: '',
            state: 'error',
            createdAt: Date.now(),
          });
          this.hooks.changed();
          this.hooks.notice(session, 'failed', `result:${item.id}`);
          continue;
        }
        if (this.hooks.stopping() || this.hooks.configuring()) break;
        const current = this.store.queued(session.id).find((queued) => queued.id === item.id);
        if (
          this.active.has(cwd) ||
          this.hooks.directoryBusy(cwd) ||
          this.worktrees.blocks(cwd) ||
          !this.store.listSessions().some((s) => s.id === session.id && !s.archived) ||
          this.paused.has(session.id) ||
          !current
        )
          continue;
        const run: Active = {
          id: randomUUID(),
          session,
          adapter: this.adapterFactory(session.provider, path),
          seq: 1,
          cancelled: false,
          rows: new Map(),
          dirty: new Set(),
        };
        this.active.set(cwd, run);
        this.hooks.emit({ type: 'message', message: this.store.begin(current, run.id) });
        this.background.schedules.started(current.id, run.id);
        this.hooks.changed();
        run.promise = this.execute(
          run,
          cwd,
          current.text,
          current.attachments || [],
          current.context,
        );
      }
    } finally {
      this.draining = false;
      for (const resolve of this.drainIdle.splice(0)) resolve();
      if (this.drainAgain) {
        this.drainAgain = false;
        queueMicrotask(() => {
          void this.drain();
        });
      }
    }
  }
  /** 将代理事件合并为本轮消息记录；取消后的事件不再接收。 */
  private accept(run: Active, event: AgentEvent) {
    if (run.cancelled || this.hooks.stopping()) return;
    const id = `${run.id}:${event.key}`,
      existing = run.rows.get(id);
    const row: Omit<Message, 'position'> = existing || {
      id,
      sessionId: run.session.id,
      runId: run.id,
      seq: 0,
      kind: event.kind,
      text: '',
      title: '',
      state: 'running',
      createdAt: Date.now(),
    };
    row.seq = ++run.seq;
    if (event.text !== undefined) row.text = event.text.slice(0, 500_000);
    if (event.delta) row.text = (row.text + event.delta).slice(0, 500_000);
    if (event.failure) row.failure = event.failure;
    if (event.title !== undefined) row.title = event.title;
    if (event.state) row.state = event.state;
    if (event.choices) row.choices = event.choices;
    if (event.questions) row.questions = event.questions;
    if (event.delegation) row.delegation = event.delegation;
    if (event.sourceThreadId) row.sourceThreadId = event.sourceThreadId;
    if (event.kind === 'plan') row.plan ||= { version: 1 };
    run.rows.set(id, row);
    run.dirty.add(id);
    if (row.state === 'pending') {
      this.store.updateSession(run.session.id, { status: 'waiting' });
      this.flush();
      this.hooks.changed();
      if (row.kind === 'approval' || row.kind === 'question')
        this.hooks.notice(run.session, 'attention', `attention:${row.id}`, row.id);
    }
  }
  /** 只保存 dirty 消息并推送界面，减少每个文本增量触发的数据库与 IPC 开销。 */
  flush() {
    for (const run of this.active.values())
      for (const id of run.dirty) {
        const row = run.rows.get(id)!;
        this.hooks.emit({ type: 'message', message: this.store.saveMessage(row) });
        run.dirty.delete(id);
      }
  }
  /** 执行一轮代理任务；无论成功或失败都关闭代理、保存状态并释放目录锁。 */
  private async execute(
    run: Active,
    path: string,
    text: string,
    attachments: import('../shared/types').Attachment[],
    context?: import('../shared/types').PromptContext,
  ) {
    let failed = false;
    try {
      const selection = await this.catalog.resolve(path, context);
      const inputs = await agentAttachments(this.attachments, attachments);
      if (run.cancelled || this.hooks.stopping()) return;
      await run.adapter.run({
        usage: (usage) => {
          if (!run.cancelled)
            this.store.sqlite
              .prepare(
                'INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
              )
              .run('usage:' + run.session.id, JSON.stringify(usage));
        },
        session: run.session,
        cwd: path,
        text:
          run.session.historySeed && !run.session.nativeId
            ? `${run.session.historySeed}\n\nCurrent user message:\n${text}`
            : text,
        promptContext: context,
        selection,
        attachments: inputs,
        turnId: (id) => this.store.setTurnId(run.id, id),
        emit: (event) => this.accept(run, event),
        nativeId: (nativeId) => {
          this.store.updateSession(run.session.id, { nativeId });
          this.hooks.changed();
        },
      });
    } catch (error) {
      if (!run.cancelled && !this.hooks.stopping()) {
        failed = true;
        this.paused.add(run.session.id);
        this.accept(run, {
          key: 'error',
          kind: 'error',
          failure: fault(error),
          text: providerError(error),
          state: 'error',
        });
      }
    } finally {
      await run.adapter.close();
      if (context?.mode === 'plan') this.paused.add(run.session.id);
      for (const row of run.rows.values()) {
        if (row.kind === 'plan' && (failed || run.cancelled)) row.state = 'running';
        if (row.state === 'pending' || row.state === 'running') {
          row.state = row.state === 'pending' || failed || run.cancelled ? 'expired' : 'done';
          row.seq = ++run.seq;
          run.dirty.add(row.id);
        }
      }
      this.flush();
      this.background.schedules.finished(
        run.id,
        this.hooks.stopping()
          ? 'interrupted'
          : run.cancelled
            ? 'cancelled'
            : failed
              ? 'failed'
              : 'completed',
      );
      this.active.delete(path);
      this.store.updateSession(run.session.id, {
        status: run.cancelled ? 'cancelled' : failed ? 'failed' : 'completed',
      });
      this.hooks.changed();
      const pending = pendingMessage(this.store, run.session.id);
      if (pending)
        this.hooks.notice(run.session, 'attention', `attention:${pending.id}`, pending.id);
      else if (!run.cancelled && !this.hooks.stopping())
        this.hooks.notice(run.session, failed ? 'failed' : 'completed', `result:${run.id}`);
      queueMicrotask(() => {
        void this.drain();
      });
    }
  }
  async stop(sessionId: string) {
    this.paused.add(sessionId);
    const run = [...this.active.values()].find((run) => run.session.id === sessionId);
    if (run) {
      run.cancelled = true;
      await run.adapter.cancel();
      await run.adapter.close();
      await run.promise;
    } else this.store.updateSession(sessionId, { status: 'cancelled' });
    this.hooks.changed();
  }
  async close() {
    // Discovery/worktree preparation may still be awaiting IO before a run exists.
    if (this.draining) await new Promise<void>((resolve) => this.drainIdle.push(resolve));
    await Promise.all(
      [...this.active.values()].map(async (run) => {
        run.cancelled = true;
        await run.adapter.cancel();
        await run.adapter.close();
        await run.promise;
      }),
    );
    clearInterval(this.flushTimer);
    this.flush();
  }
}
