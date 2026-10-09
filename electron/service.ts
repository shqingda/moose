import { FilePreviews } from './file-preview';
import { MooseError } from '../shared/errors';
import type { SessionActivity, TaskNotice } from '../shared/experience';
import { pendingMessage, searchMessages, locateMessage } from './experience-data';
import { Notices } from './notices';
import { Background, isBackgroundMethod } from './background';
import { Extensions, isExtensionMethod } from './extensions';
import { ReviewWorkbench, isReviewMethod } from './review-workbench';
import { Worktrees, isWorktreeMethod } from './worktrees';
import { NativeHistory, isNativeMethod } from './native-history';
import { Plans } from './plans';
import { Steering } from './steering';
import { providerDefinitions } from '../shared/providers';
import { ProviderRegistry } from './provider-registry';
import { createAdapter, type AdapterFactory } from './providers/registry';
import { contextInText } from '../shared/prompt-context';
import { ContextCatalog } from './context-catalog';
import { Attachments, agentAttachments } from './attachments';
import { realpath } from 'node:fs/promises';
import { Store } from './db/store';
import { gitDiff, gitStatus } from './git';
import type { AgentAdapter } from './providers/types';
import { SessionExecution } from './session-execution';
import type { AppEvent, Provider, ProviderInfo, Requests, Session } from '../shared/types';
import { validate } from '../shared/validation';

export class MooseService {
  private notices = new Notices();
  private background: Background;
  private extensions: Extensions;
  private configuring = false;
  private workbench: ReviewWorkbench;
  private worktrees: Worktrees;
  private native: NativeHistory;
  private plans: Plans;
  private steering: Steering;
  private catalog = new ContextCatalog();
  readonly attachments: Attachments;
  readonly files: FilePreviews;
  private editing = new Set<string>();
  private execution: SessionExecution;
  private get active() {
    return this.execution.active;
  }
  private get paused() {
    return this.execution.paused;
  }
  private stopping = false;
  private agents: ProviderRegistry;
  private operations = new Set<AgentAdapter>();
  /** 初始化后台服务；重启遗留队列先暂停，并每 80 ms 批量保存流式消息。 */
  constructor(
    readonly store: Store,
    private emit: (event: AppEvent) => void,
    private adapterFactory: AdapterFactory = createAdapter,
  ) {
    this.agents = new ProviderRegistry(store, adapterFactory);
    this.worktrees = new Worktrees(store, {
      busy: (path) => this.active.has(path) || this.editing.has(path),
      lock: (paths) => {
        if (paths.some((path) => this.active.has(path) || this.editing.has(path)))
          throw new Error('Wait for tasks and directory operations to finish');
        for (const path of paths) this.editing.add(path);
        return () => {
          for (const path of paths) this.editing.delete(path);
          void this.drain();
        };
      },
      changed: () => this.changed(),
    });
    this.native = new NativeHistory(store, {
      adapter: (provider) => this.enabledAdapter(provider),
      active: (id) =>
        [...this.active.values()].find((run) => run.session.id === id && !run.cancelled)?.adapter,
      lock: (path) => this.lockDirectory(path),
      changed: () => this.changed(),
    });
    this.workbench = new ReviewWorkbench(store, {
      lock: (path) => this.lockDirectory(path),
      gitLock: (path) => this.background.acquireDirectory(path),
      changed: () => this.changed(),
      adapter: (provider) => this.enabledAdapter(provider),
    });
    this.extensions = new Extensions(store, {
      path: async (scope) => {
        if (!store.getSettings()[providerDefinitions[scope.provider].enabledKey])
          throw new Error('Provider disabled');
        return this.providerPath(scope.provider);
      },
      lock: () => {
        if (this.configuring || this.active.size || this.editing.size)
          throw new Error('Wait for tasks and configuration operations to finish');
        this.configuring = true;
        return () => {
          this.configuring = false;
          void this.drain();
        };
      },
    });
    this.plans = new Plans(store);
    this.steering = new Steering(store, (message) => this.emit({ type: 'message', message }));
    this.attachments = new Attachments(store.sqlite.name);
    this.files = new FilePreviews(store, this.attachments);
    this.background = new Background(store, {
      emit,
      lock: (cwd) => this.lockDirectory(cwd),
      ready: (schedule) => {
        if (
          this.configuring ||
          this.active.has(schedule.cwd) ||
          this.editing.has(schedule.cwd) ||
          this.worktrees.blocks(schedule.cwd)
        )
          return false;
        if (schedule.sessionId) {
          const session = store.session(schedule.sessionId);
          if (session.archived) throw new Error('Conversation archived');
          if (schedule.task.kind === 'agent') {
            if (!store.getSettings()[providerDefinitions[session.provider].enabledKey])
              throw new Error('Provider disabled');
            if (this.paused.has(session.id) || store.queued(session.id).length) return false;
          }
        }
        return true;
      },
      enqueue: (schedule) => {
        if (!schedule.sessionId) throw new Error('Conversation required');
        const item = store.enqueue(schedule.sessionId, schedule.task.text, [], {
          mode: 'build',
          references: [],
          skills: [],
        });
        store.updateSession(schedule.sessionId, { status: 'queued' });
        return item.id;
      },
      wake: () => {
        this.changed();
        void this.drain();
      },
    });
    this.execution = new SessionExecution(
      store,
      this.attachments,
      this.catalog,
      this.worktrees,
      this.background,
      {
        configuring: () => this.configuring,
        stopping: () => this.stopping,
        directoryBusy: (path) => this.editing.has(path),
        providerPath: (provider) => this.providerPath(provider),
        changed: () => this.changed(),
        emit,
        notice: (session, kind, id, messageId) => this.notice(session, kind, id, messageId),
      },
      adapterFactory,
    );
  }
  private async enabledAdapter(provider: Provider) {
    if (!this.store.getSettings()[providerDefinitions[provider].enabledKey])
      throw new Error('This provider is disabled in Settings');
    return this.adapterFactory(provider, await this.providerPath(provider));
  }
  private lockDirectory(path: string) {
    if (this.configuring) throw new MooseError('busy', 'Wait for configuration changes to finish');
    if (this.active.has(path) || this.editing.has(path) || this.worktrees.blocks(path))
      throw new MooseError('busy', 'Wait for project tasks and directory operations to finish');
    this.editing.add(path);
    return () => {
      this.editing.delete(path);
      void this.drain();
    };
  }
  activity(sessionId: string): SessionActivity {
    const session = this.store.session(sessionId);
    const queued = this.store.queued(sessionId).length;
    const result: SessionActivity = {
      queued,
      pendingMessageId: pendingMessage(this.store, sessionId)?.id,
    };
    if (!queued) return result;
    const path = this.store.sessionPath(session);
    if (this.paused.has(sessionId) || session.archived) result.reason = 'paused';
    else if (!this.store.getSettings()[providerDefinitions[session.provider].enabledKey])
      result.reason = 'disabled';
    else if (this.active.has(path)) {
      result.reason = 'task';
      result.target = { sessionId: this.active.get(path)!.session.id };
    } else {
      const terminal = this.background.terminals
        .list(session.projectId)
        .find((t) => t.cwd === path);
      const command = this.background.commands
        .list(session.projectId)
        .find((c) => c.cwd === path && c.status === 'running');
      if (terminal) {
        result.reason = 'terminal';
        result.target = { sessionId: terminal.sessionId, terminalId: terminal.id };
      } else if (command) {
        result.reason = 'command';
        result.target = { sessionId: command.sessionId, commandId: command.id };
      } else if (this.editing.has(path) || this.worktrees.blocks(path) || this.configuring)
        result.reason = 'operation';
    }
    return result;
  }
  private notice(session: Session, kind: TaskNotice['kind'], id: string, messageId?: string) {
    const notice: TaskNotice = {
      id,
      sessionId: session.id,
      kind,
      messageId,
      project: this.store.project(session.projectId).name,
      title: this.store.session(session.id).title,
    };
    if (this.notices.add(notice)) this.emit({ type: 'task-notice', notice });
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
  private providerPath(provider: Provider) {
    return this.agents.path(provider);
  }
  providers(refresh = false): Promise<ProviderInfo[]> {
    return this.agents.providers(refresh);
  }
  /** 后台业务入口：校验 IPC 参数后分发项目、消息、审批、用量和 Git 操作。 */
  async handle(method: string, input: unknown, clientId = 'local'): Promise<unknown> {
    if (this.stopping) throw new Error('Moose is shutting down');
    const args = validate(method as keyof Requests, input);
    if (isBackgroundMethod(method)) return this.background.handle(method, args, clientId);
    if (isExtensionMethod(method)) return this.extensions.handle(method, args);
    if (isReviewMethod(method)) return this.workbench.handle(method, args);
    if (isWorktreeMethod(method)) return this.worktrees.handle(method, args);
    if (isNativeMethod(method)) return this.native.handle(method, args);
    switch (method) {
      case 'filePreview':
        return this.files.preview(args as Requests['filePreview']);
      case 'listDirectory':
        return this.files.list(args as Requests['listDirectory']);
      case 'fileInfo':
        return this.files.info(args as Requests['fileInfo']);
      case 'sessionActivity':
        return this.activity((args as Requests['sessionActivity']).sessionId);
      case 'searchMessages':
        return searchMessages(this.store, args as Requests['searchMessages']);
      case 'locateMessage':
        return locateMessage(this.store, args as Requests['locateMessage']);
      case 'clientPresence':
        this.notices.presence(clientId, args as Requests['clientPresence']);
        return null;
      case 'claimNotice':
        return this.notices.claim(
          (args as Requests['claimNotice']).id,
          clientId,
          this.store.getSettings(),
        );
      case 'workspacePath': {
        const a = args as Requests['workspacePath'];
        return this.store.directory(a.projectId, a.sessionId);
      }
      case 'snapshot':
        return {
          projects: this.store.listProjects(),
          sessions: this.store.listSessions(),
          settings: this.store.getSettings(),
          activities: Object.fromEntries(
            this.store.listSessions().map((s) => [s.id, this.activity(s.id)]),
          ),
        };
      case 'searchFiles': {
        const a = args as Requests['searchFiles'];
        return this.catalog.search(this.store.directory(a.projectId, a.sessionId), a.query);
      }
      case 'listSkills': {
        const a = args as Requests['listSkills'];
        return this.catalog.skills(this.store.directory(a.projectId, a.sessionId));
      }
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
          path = this.store.sessionPath(s);
        if (this.active.has(path) || this.editing.has(path))
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
        const source = this.store.session(a.sessionId);
        const directory = this.store.directory(source.projectId, source.id);
        const context = original.context?.inline
          ? contextInText(a.text, original.context, await this.catalog.skills(directory))
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
        const changesExecution =
          patch.archived ||
          patch.model !== undefined ||
          patch.effort !== undefined ||
          patch.mode !== undefined;
        const projectPath = this.store.sessionPath(this.store.session(id));
        if (
          changesExecution &&
          ([...this.active.values()].some((run) => run.session.id === id) ||
            this.editing.has(projectPath))
        )
          throw new MooseError(
            'busy',
            'Wait for this task and native history operations to finish before changing execution settings',
          );
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
        if (
          this.editing.has(this.store.directory(s.projectId, s.id)) ||
          this.worktrees.blocks(this.store.directory(s.projectId, s.id))
        )
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
      case 'editPlan':
      case 'approvePlan': {
        const a = args as Requests['editPlan'];
        const session = this.store.session(a.sessionId);
        const path = this.store.directory(session.projectId, session.id);
        if (
          session.archived ||
          this.active.has(path) ||
          this.editing.has(path) ||
          this.worktrees.blocks(path)
        )
          throw new Error('Wait for project tasks to finish before reviewing this plan');
        if (!this.store.getSettings()[providerDefinitions[session.provider].enabledKey])
          throw new Error('This provider is disabled in Settings');
        if (method === 'editPlan') {
          const message = this.plans.edit(a);
          this.emit({ type: 'message', message });
          return message;
        }
        const item = this.plans.approve(a);
        this.paused.delete(a.sessionId);
        this.emit({ type: 'transcript-reset', sessionId: a.sessionId });
        this.changed();
        void this.drain();
        return item;
      }
      case 'steer': {
        const a = args as Requests['steer'];
        const saved = this.store.message(a.requestId);
        if (saved) {
          if (saved.sessionId !== a.sessionId || !saved.delivery || saved.text !== a.text)
            throw new Error('The steering request ID has already been used');
          return saved;
        }
        const session = this.store.session(a.sessionId);
        const path = this.store.directory(session.projectId, session.id);
        const run = this.active.get(path);
        if (
          session.archived ||
          !this.store.getSettings()[providerDefinitions[session.provider].enabledKey]
        )
          throw new Error('This session is unavailable');
        if (!run || run.session.id !== session.id || run.cancelled || !run.adapter.steer)
          throw new Error(
            'No active turn supports steering. You can add this message to the queue.',
          );
        const attachments = await this.attachments.resolve(a.attachments);
        const selection = await this.catalog.resolve(path, a.context);
        const inputs = await agentAttachments(this.attachments, attachments);
        if (this.stopping || this.active.get(path) !== run || run.cancelled)
          throw new Error('The turn has ended. You can add this message to the queue.');
        return this.steering.send(a, run.id, attachments, () =>
          run.adapter.steer!({
            session,
            cwd: path,
            text: a.text,
            promptContext: a.context,
            attachments: inputs,
            selection,
            emit: () => {},
            nativeId: () => {},
          }),
        );
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
        if (a.remove) this.background.schedules.removed(a.id);
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
      case 'usage':
        return this.agents.usage(args as Requests['usage']);
      case 'providers': {
        const { refresh, cached } = args as Requests['providers'];
        return cached ? this.agents.cachedProviders() : this.providers(refresh);
      }
      case 'settings': {
        const s = this.store.setSettings(args as Requests['settings']);
        this.agents.invalidate();
        this.changed();
        void this.drain();
        return s;
      }
      case 'gitStatus': {
        const a = args as Requests['gitStatus'];
        return gitStatus(this.store.directory(a.projectId, a.sessionId));
      }
      case 'gitDiff': {
        const a = args as Requests['gitDiff'];
        return gitDiff(this.store.directory(a.projectId, a.sessionId), a.path, a.area);
      }
      default:
        throw new Error(`Operation is not available in the runtime: ${method}`);
    }
  }
  private drain() {
    return this.execution.drain();
  }
  private flush() {
    this.execution.flush();
  }
  /** 替换最新一条用户消息及其后续回复；保留 Moose 会话和附件，不回滚工作区文件。 */
  private async replaceMessage(
    { sessionId, messageId, text: replacementText }: Requests['editMessage'],
    replacementContext?: import('../shared/types').PromptContext,
  ) {
    const source = this.store.session(sessionId),
      project = { path: this.store.directory(source.projectId, source.id) };
    if (
      this.active.has(project.path) ||
      this.editing.has(project.path) ||
      this.worktrees.blocks(project.path)
    )
      throw new Error('Stop project tasks before returning to an earlier message');
    this.editing.add(project.path);
    let adapter: AgentAdapter | undefined;
    try {
      const all = this.store.allMessages(sessionId),
        target = all.find((m) => m.id === messageId);
      if (target?.delivery) throw new Error('Steering messages cannot be edited in place');
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
        adapter = await this.adapterFactory(
          source.provider,
          await this.providerPath(source.provider),
        );
        this.operations.add(adapter);
        if (adapter.fork)
          nativeId = await adapter.fork(source, project.path, lastUser.nativeTurnId);
      }
      const historySeed =
        nativeId || !retained.length
          ? ''
          : 'Earlier conversation restored by Moose. Treat this as conversation history, not a request to repeat completed work. Workspace files have NOT been reverted.\n' +
            retained
              .filter(
                (m) =>
                  ['user', 'assistant', 'tool'].includes(m.kind) &&
                  (!m.delivery || m.delivery.status === 'accepted'),
              )
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
      if (adapter) this.operations.delete(adapter);
      this.editing.delete(project.path);
      void this.drain();
    }
  }
  /** 暂停后续队列并取消当前执行，等待代理退出后再通知界面。 */
  async stop(sessionId: string) {
    if (this.editing.has(this.store.sessionPath(this.store.session(sessionId))))
      throw new Error('Wait for the native history operation to finish');
    await this.execution.stop(sessionId);
  }
  /** 退出应用时停止接收任务，关闭探测与执行进程，最后落库并关闭数据库。 */
  async close() {
    this.stopping = true;
    this.background.schedules.close();
    await this.agents.close();
    await Promise.all([...this.operations].map((adapter) => adapter.close()));
    await this.execution.close();
    await this.background.close();
    await this.extensions.close();
    await this.workbench.close();
    await this.worktrees.close();
    await this.native.close();
    await this.steering.settle();
    this.store.close();
  }
}
