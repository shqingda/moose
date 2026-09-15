import { providerDefinitions, providerIds } from '../shared/providers';
import { createAdapter } from './providers/registry';
import { contextInText } from '../shared/prompt-context';
import { ContextCatalog } from './context-catalog';
import { Attachments, agentAttachments } from './attachments';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { Store } from './db/store';
import { discover, cliVersion } from './providers/process';
import { gitDiff, gitStatus } from './git';
import { providerError, type AgentAdapter, type AgentEvent } from './providers/types';
import type { AppEvent, Message, Provider, ProviderInfo, Requests, Session } from '../shared/types';
import { validate } from '../shared/validation';

type Active = {
  id: string;
  session: Session;
  adapter: AgentAdapter;
  seq: number;
  cancelled: boolean;
  rows: Map<string, Omit<Message, 'position'>>;
  dirty: Set<string>;
  promise?: Promise<void>;
};
export class MooseService {
  private catalog = new ContextCatalog();
  readonly attachments: Attachments;
  private editing = new Set<string>();
  private active = new Map<string, Active>();
  private paused = new Set<string>();
  private stopping = false;
  private usageCache = new Map<
    Provider,
    { at: number; value: import('../shared/types').UsageInfo }
  >();
  private usagePending = new Map<Provider, Promise<import('../shared/types').UsageInfo>>();
  private providerCache?: ProviderInfo[];
  private probePromise?: Promise<ProviderInfo[]>;
  private probing = new Set<AgentAdapter>();
  private flushTimer: ReturnType<typeof setInterval>;
  /** 初始化后台服务；重启遗留队列先暂停，并每 80 ms 批量保存流式消息。 */
  constructor(
    readonly store: Store,
    private emit: (event: AppEvent) => void,
    private adapterFactory = createAdapter,
  ) {
    this.attachments = new Attachments(store.sqlite.name);
    for (const item of store.queued()) this.paused.add(item.sessionId);
    this.flushTimer = setInterval(() => this.flush(), 80);
  }
  /** 通知界面重新读取项目、会话或队列快照。 */
  changed() {
    this.emit({ type: 'changed' });
  }
  /** 规范化真实目录路径，避免同一目录被重复加入或绕过串行调度。 */
  async addProject(path: string) {
    const project = this.store.addProject(await realpath(path));
    this.changed();
    return project;
  }
  /** 根据用户配置或默认搜索路径定位本机代理 CLI。 */
  private async providerPath(provider: Provider) {
    const settings = this.store.getSettings();
    return discover(provider, settings[providerDefinitions[provider].pathKey]);
  }
  /** 并行探测代理版本与能力；缓存结果，并合并重复探测请求。 */
  async providers(refresh = false): Promise<ProviderInfo[]> {
    if (!refresh && this.providerCache) return this.providerCache;
    if (this.probePromise) return this.probePromise;
    this.probePromise = Promise.all(
      providerIds.map(async (provider) => {
        const info: ProviderInfo = {
          enabled: this.store.getSettings()[providerDefinitions[provider].enabledKey],
          provider,
          path: '',
          version: '',
          available: false,
          connected: false,
          models: [],
          modes: [],
        };
        let adapter: AgentAdapter | undefined;
        try {
          info.path = await this.providerPath(provider);
          info.available = true;
          info.version = await cliVersion(info.path);
          if (this.stopping || !info.enabled) return info;
          adapter = this.adapterFactory(provider, info.path);
          this.probing.add(adapter);
          Object.assign(info, await adapter.probe());
          info.connected = true;
        } catch (error) {
          info.error = providerError(error);
        } finally {
          if (adapter) {
            await adapter.close();
            this.probing.delete(adapter);
          }
        }
        return info;
      }),
    );
    try {
      this.providerCache = await this.probePromise;
      return this.providerCache;
    } finally {
      this.probePromise = undefined;
    }
  }
  /** 后台业务入口：校验 IPC 参数后分发项目、消息、审批、用量和 Git 操作。 */
  async handle(method: string, input: unknown): Promise<unknown> {
    if (this.stopping) throw new Error('Moose is shutting down');
    const args = validate(method as keyof Requests, input);
    switch (method) {
      case 'snapshot':
        return {
          projects: this.store.listProjects(),
          sessions: this.store.listSessions(),
          settings: this.store.getSettings(),
        };
      case 'searchFiles': {
        const a = args as Requests['searchFiles'];
        return this.catalog.search(this.store.project(a.projectId).path, a.query);
      }
      case 'listSkills':
        return this.catalog.skills(
          this.store.project((args as Requests['listSkills']).projectId).path,
        );
      case 'uploadAttachment': {
        const a = args as Requests['uploadAttachment'];
        return this.attachments.import(a.name, Buffer.from(a.data, 'base64'));
      }
      case 'attachmentPreview':
        return this.attachments.preview((args as Requests['attachmentPreview']).id);
      case 'deleteProject': {
        const projectId = (args as Requests['deleteProject']).projectId;
        const project = this.store.project(projectId);
        if (this.active.has(project.path) || this.editing.has(project.path))
          throw new Error('Stop the project tasks before changing this project');
        this.store.deleteProject(projectId);
        this.changed();
        return null;
      }
      case 'deleteSession': {
        const { sessionId } = args as Requests['deleteSession'];
        const s = this.store.session(sessionId),
          project = this.store.project(s.projectId);
        if (this.active.has(project.path) || this.editing.has(project.path))
          throw new Error('Stop project tasks before deleting a conversation');
        this.store.deleteSession(sessionId);
        this.paused.delete(sessionId);
        this.changed();
        return null;
      }
      case 'editMessage': {
        const a = args as Requests['editMessage'];
        const original = this.store.allMessages(a.sessionId).find((m) => m.id === a.messageId);
        if (!original || original.kind !== 'user')
          throw new Error('Only user messages can be edited');
        if (!a.text && !original.attachments?.length) throw new Error('Add message text');
        const project = this.store.project(this.store.session(a.sessionId).projectId);
        const context = original.context?.inline
          ? contextInText(a.text, original.context, await this.catalog.skills(project.path))
          : original.context;
        return this.replaceMessage(a, context);
      }
      case 'createSession': {
        const a = args as Requests['createSession'];
        const s = this.store.createSession(a.projectId, a.provider);
        this.changed();
        void this.drain();
        return s;
      }
      case 'updateSession': {
        const { id, draftAttachments, ...patch } = args as Requests['updateSession'];
        if (
          [...this.active.values()].some((run) => run.session.id === id) &&
          (patch.archived ||
            patch.model !== undefined ||
            patch.effort !== undefined ||
            patch.mode !== undefined)
        )
          throw new Error('Stop this task before changing its execution settings');
        if (patch.archived) this.paused.add(id);
        const s = this.store.updateSession(id, {
          ...patch,
          ...(draftAttachments
            ? { draftAttachments: await this.attachments.resolve(draftAttachments) }
            : {}),
        });
        if (patch.draft === undefined) this.changed();
        return s;
      }
      case 'responseText': {
        const a = args as Requests['responseText'];
        return this.store
          .allMessages(a.sessionId)
          .filter((m) => m.runId === a.runId && m.kind === 'assistant')
          .map((m) => m.text)
          .filter(Boolean)
          .join('\n\n');
      }
      case 'messages': {
        const a = args as Requests['messages'];
        return this.store.page(a.sessionId, a.before);
      }
      case 'send': {
        const a = args as Requests['send'];
        const s = this.store.session(a.sessionId);
        if (this.editing.has(this.store.project(s.projectId).path))
          throw new Error('Please wait for the history operation to finish');
        if (!this.store.getSettings()[providerDefinitions[s.provider].enabledKey])
          throw new Error('This provider is disabled in Settings');
        if (s.archived) throw new Error('Restore this session before sending a message');
        const item = this.store.enqueue(
          s.id,
          a.text,
          await this.attachments.resolve(a.attachments),
          a.context,
        );
        this.paused.delete(s.id);
        if (![...this.active.values()].some((run) => run.session.id === s.id))
          this.store.updateSession(s.id, { status: 'queued' });
        this.changed();
        void this.drain();
        return item;
      }
      case 'stop': {
        await this.stop((args as Requests['stop']).sessionId);
        return null;
      }
      case 'queue':
        return this.store.queued((args as Requests['queue']).sessionId);
      case 'resumeQueue': {
        this.paused.delete((args as Requests['resumeQueue']).sessionId);
        void this.drain();
        return null;
      }
      case 'updateQueue': {
        const a = args as Requests['updateQueue'];
        this.store.updateQueue(a.id, a.text, a.remove);
        this.changed();
        return null;
      }
      case 'respond': {
        const a = args as Requests['respond'];
        const run = [...this.active.values()].find((run) => run.session.id === a.sessionId);
        const row = run?.rows.get(a.messageId);
        if (!run || !row || row.state !== 'pending' || run.cancelled)
          throw new Error('This request is no longer active');
        if (row.questions?.some((q) => !a.answers?.[q.id]?.trim()))
          throw new Error('Answer each question before continuing');
        run.adapter.respond(a.messageId.slice(run.id.length + 1), a.choice, a.answers);
        row.state = 'resolved';
        row.seq = ++run.seq;
        run.dirty.add(row.id);
        this.store.updateSession(run.session.id, {
          status: [...run.rows.values()].some((row) => row.state === 'pending')
            ? 'waiting'
            : 'running',
        });
        this.flush();
        this.changed();
        return null;
      }
      case 'usage': {
        const a = args as Requests['usage'];
        if (a.sessionId && this.store.session(a.sessionId).provider !== a.provider)
          throw new Error('Provider does not match session');
        const saved = a.sessionId
          ? (this.store.sqlite
              .prepare('SELECT value FROM settings WHERE key = ?')
              .get('usage:' + a.sessionId) as { value: string } | undefined)
          : undefined;
        const context = saved ? JSON.parse(saved.value) : null;
        let cached = this.usageCache.get(a.provider);
        if (!cached || Date.now() - cached.at > 60000) {
          let pending = this.usagePending.get(a.provider);
          if (!pending) {
            pending = (async () => {
              const adapter = this.adapterFactory(a.provider, await this.providerPath(a.provider));
              this.probing.add(adapter);
              try {
                const value = (await adapter.usage?.()) || { context: null, limits: [] };
                this.usageCache.set(a.provider, { at: Date.now(), value });
                return value;
              } finally {
                await adapter.close();
                this.probing.delete(adapter);
              }
            })();
            this.usagePending.set(a.provider, pending);
            void pending.finally(() => this.usagePending.delete(a.provider)).catch(() => {});
          }
          try {
            await pending;
          } catch (error) {
            return { ...(cached?.value || { limits: [] }), context, error: providerError(error) };
          }
          cached = this.usageCache.get(a.provider);
        }
        return {
          ...(cached?.value || { limits: [] }),
          context:
            context ||
            (!a.sessionId || !this.store.allMessages(a.sessionId).length
              ? { used: 0, capacity: null }
              : null),
        };
      }
      case 'providers':
        return this.providers((args as Requests['providers']).refresh);
      case 'settings': {
        this.providerCache = undefined;
        const s = this.store.setSettings(args as Requests['settings']);
        this.changed();
        void this.drain();
        return s;
      }
      case 'gitStatus':
        return gitStatus(this.store.project((args as Requests['gitStatus']).projectId).path);
      case 'gitDiff': {
        const a = args as Requests['gitDiff'];
        return gitDiff(this.store.project(a.projectId).path, a.path, a.area);
      }
      default:
        throw new Error(`Operation is not available in the runtime: ${method}`);
    }
  }
  private draining = false;
  private drainAgain = false;
  /** 按入队顺序启动可执行任务；同目录串行，不同目录可并行。 */
  private async drain() {
    if (this.stopping) return;
    if (this.draining) {
      this.drainAgain = true;
      return;
    }
    this.draining = true;
    try {
      for (const item of this.store.queued()) {
        if (this.stopping || this.paused.has(item.sessionId)) continue;
        const session = this.store.listSessions().find((s) => s.id === item.sessionId);
        if (!session || !this.store.getSettings()[providerDefinitions[session.provider].enabledKey])
          continue;
        const project = this.store.project(session.projectId);
        if (session.archived || this.active.has(project.path) || this.editing.has(project.path))
          continue;
        let path: string;
        try {
          path = await this.providerPath(session.provider);
        } catch (error) {
          this.paused.add(session.id);
          this.store.updateSession(session.id, { status: 'failed' });
          this.store.saveMessage({
            id: randomUUID(),
            runId: randomUUID(),
            sessionId: session.id,
            seq: 1,
            kind: 'error',
            text: error instanceof Error ? error.message : String(error),
            title: '',
            state: 'error',
            createdAt: Date.now(),
          });
          this.changed();
          continue;
        }
        if (this.stopping) break;
        if (
          this.editing.has(project.path) ||
          !this.store.listSessions().some((s) => s.id === session.id && !s.archived) ||
          this.paused.has(session.id) ||
          !this.store.queued(session.id).some((queued) => queued.id === item.id)
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
        this.active.set(project.path, run);
        this.emit({ type: 'message', message: this.store.begin(item, run.id) });
        this.changed();
        run.promise = this.execute(
          run,
          project.path,
          item.text,
          item.attachments || [],
          item.context,
        );
      }
    } finally {
      this.draining = false;
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
    if (run.cancelled || this.stopping) return;
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
    if (event.title !== undefined) row.title = event.title;
    if (event.state) row.state = event.state;
    if (event.choices) row.choices = event.choices;
    if (event.questions) row.questions = event.questions;
    run.rows.set(id, row);
    run.dirty.add(id);
    if (row.state === 'pending') {
      this.store.updateSession(run.session.id, { status: 'waiting' });
      this.flush();
      this.changed();
    }
  }
  /** 只保存 dirty 消息并推送界面，减少每个文本增量触发的数据库与 IPC 开销。 */
  private flush() {
    for (const run of this.active.values())
      for (const id of run.dirty) {
        const row = run.rows.get(id)!;
        this.emit({ type: 'message', message: this.store.saveMessage(row) });
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
        selection: await this.catalog.resolve(path, context),
        attachments: await agentAttachments(this.attachments, attachments),
        turnId: (id) => this.store.setTurnId(run.id, id),
        emit: (event) => this.accept(run, event),
        nativeId: (nativeId) => {
          this.store.updateSession(run.session.id, { nativeId });
          this.changed();
        },
      });
    } catch (error) {
      if (!run.cancelled && !this.stopping) {
        failed = true;
        this.paused.add(run.session.id);
        this.accept(run, {
          key: 'error',
          kind: 'error',
          text: providerError(error),
          state: 'error',
        });
      }
    } finally {
      await run.adapter.close();
      for (const row of run.rows.values()) {
        if (row.state === 'pending' || row.state === 'running') {
          row.state = row.state === 'pending' || failed || run.cancelled ? 'expired' : 'done';
          row.seq = ++run.seq;
          run.dirty.add(row.id);
        }
      }
      this.flush();
      this.active.delete(path);
      this.store.updateSession(run.session.id, {
        status: run.cancelled ? 'cancelled' : failed ? 'failed' : 'completed',
      });
      this.changed();
      queueMicrotask(() => {
        void this.drain();
      });
    }
  }
  /** 替换最新一条用户消息及其后续回复；保留 Moose 会话和附件，不回滚工作区文件。 */
  private async replaceMessage(
    { sessionId, messageId, text: replacementText }: Requests['editMessage'],
    replacementContext?: import('../shared/types').PromptContext,
  ) {
    const source = this.store.session(sessionId),
      project = this.store.project(source.projectId);
    if (this.active.has(project.path) || this.editing.has(project.path))
      throw new Error('Stop project tasks before returning to an earlier message');
    this.editing.add(project.path);
    let adapter: AgentAdapter | undefined;
    try {
      const all = this.store.allMessages(sessionId),
        target = all.find((m) => m.id === messageId);
      if (!target || target.kind !== 'user') throw new Error('Choose a conversation message');
      if (
        all.filter((m) => m.kind === 'user').at(-1)?.id !== target.id ||
        source.archived ||
        this.store.queued(sessionId).length
      )
        throw new Error('Only the latest user message in an idle conversation can be edited');
      const start = all.find((m) => m.runId === target.runId && m.kind === 'user') || target;
      const retained = all.filter((m) => m.position < start.position);
      let nativeId: string | null = null;
      const lastUser = retained.filter((m) => m.kind === 'user').at(-1);
      if (source.provider === 'codex' && source.nativeId && lastUser?.nativeTurnId) {
        adapter = this.adapterFactory(source.provider, await this.providerPath(source.provider));
        this.probing.add(adapter);
        if (adapter.fork)
          nativeId = await adapter.fork(source, project.path, lastUser.nativeTurnId);
      }
      const historySeed =
        nativeId || !retained.length
          ? ''
          : 'Earlier conversation restored by Moose. Treat this as conversation history, not a request to repeat completed work. Workspace files have NOT been reverted.\n' +
            retained
              .filter((m) => ['user', 'assistant', 'tool'].includes(m.kind))
              .map(
                (m) =>
                  `${m.kind}: ${m.text}${m.attachments?.length ? '\nAttachments: ' + m.attachments.map((a) => this.attachments.path(a)).join(', ') : ''}`,
              )
              .join('\n\n');
      if (historySeed.length > 500_000)
        throw new Error(
          'This history is too large to restore without a native checkpoint. Choose a more recent session.',
        );
      if (this.stopping) throw new Error('Moose is shutting down');
      this.store.replaceLastTurn(
        source.id,
        target.position,
        nativeId,
        historySeed,
        replacementText,
        target.attachments || [],
        replacementContext,
      );
      this.paused.delete(source.id);
      this.emit({ type: 'transcript-reset', sessionId });
      this.changed();
      return this.store.session(source.id);
    } finally {
      await adapter?.close();
      if (adapter) this.probing.delete(adapter);
      this.editing.delete(project.path);
      void this.drain();
    }
  }
  /** 暂停后续队列并取消当前执行，等待代理退出后再通知界面。 */
  async stop(sessionId: string) {
    this.paused.add(sessionId);
    const run = [...this.active.values()].find((run) => run.session.id === sessionId);
    if (run) {
      run.cancelled = true;
      await run.adapter.cancel();
      await run.adapter.close();
      await run.promise;
    } else this.store.updateSession(sessionId, { status: 'cancelled' });
    this.changed();
  }
  /** 退出应用时停止接收任务，关闭探测与执行进程，最后落库并关闭数据库。 */
  async close() {
    this.stopping = true;
    await Promise.all([...this.probing].map((adapter) => adapter.close()));
    await this.probePromise?.catch(() => {});
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
    this.store.close();
  }
}
