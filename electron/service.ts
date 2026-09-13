import { ContextCatalog } from './context-catalog';
import { Attachments, agentAttachments } from './attachments';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { Store } from './db/store';
import { CodexAdapter } from './providers/codex';
import { GrokAdapter } from './providers/grok';
import { discover, cliVersion } from './providers/process';
import { gitDiff, gitStatus } from './git';
import { providerError, type AgentAdapter, type AgentEvent } from './providers/types';
import type { AppEvent, Message, Provider, ProviderInfo, Requests, Session } from '../shared/types';
import { validate } from '../shared/validation';

type Active = { id: string; session: Session; adapter: AgentAdapter; seq: number; cancelled: boolean; rows: Map<string, Omit<Message, 'position'>>; dirty: Set<string>; promise?: Promise<void> };
export class MooseService {
  private catalog = new ContextCatalog();
  readonly attachments: Attachments;
  private editing = new Set<string>();
  private active = new Map<string, Active>();
  private paused = new Set<string>();
  private stopping = false;
  private providerCache?: ProviderInfo[];
  private probePromise?: Promise<ProviderInfo[]>;
  private probing = new Set<AgentAdapter>();
  private flushTimer: ReturnType<typeof setInterval>;
  constructor(readonly store: Store, private emit: (event: AppEvent) => void, private adapterFactory = (provider: Provider, path: string): AgentAdapter => provider === 'codex' ? new CodexAdapter(path) : new GrokAdapter(path)) {
    this.attachments = new Attachments(store.sqlite.name);
    for (const item of store.queued()) this.paused.add(item.sessionId);
    this.flushTimer = setInterval(() => this.flush(), 80);
  }
  changed() { this.emit({ type: 'changed' }); }
  async addProject(path: string) { const project = this.store.addProject(await realpath(path)); this.changed(); return project; }
  private async providerPath(provider: Provider) { const settings = this.store.getSettings(); return discover(provider, provider === 'codex' ? settings.codexPath : settings.grokPath); }
  async providers(refresh = false): Promise<ProviderInfo[]> {
    if (!refresh && this.providerCache) return this.providerCache;
    if (this.probePromise) return this.probePromise;
    this.probePromise = Promise.all((['codex', 'grok'] as const).map(async provider => {
      const info: ProviderInfo = { provider, path: '', version: '', available: false, connected: false, models: [], modes: [] };
      let adapter: AgentAdapter | undefined;
      try {
        info.path = await this.providerPath(provider); info.available = true;
        info.version = await cliVersion(info.path);
        if (this.stopping) return info;
        adapter = this.adapterFactory(provider, info.path);
        this.probing.add(adapter);
        Object.assign(info, await adapter.probe()); info.connected = true;
      } catch (error) { info.error = providerError(error); }
      finally { if (adapter) { await adapter.close(); this.probing.delete(adapter); } }
      return info;
    }));
    try { this.providerCache = await this.probePromise; return this.providerCache; }
    finally { this.probePromise = undefined; }
  }
  async handle(method: string, input: unknown): Promise<unknown> {
    if (this.stopping) throw new Error('Moose is shutting down');
    const args = validate(method as keyof Requests, input);
    switch (method) {
      case 'snapshot': return { projects: this.store.listProjects(), sessions: this.store.listSessions(), settings: this.store.getSettings() };
      case 'searchFiles': { const a = args as Requests['searchFiles']; return this.catalog.search(this.store.project(a.projectId).path, a.query); }
      case 'listSkills': return this.catalog.skills(this.store.project((args as Requests['listSkills']).projectId).path);
      case 'uploadAttachment': { const a = args as Requests['uploadAttachment']; return this.attachments.import(a.name, Buffer.from(a.data, 'base64')); }
      case 'attachmentPreview': return this.attachments.preview((args as Requests['attachmentPreview']).id);
      case 'deleteProject': case 'archiveProject': {
        const projectId = (args as Requests['deleteProject']).projectId;
        const project = this.store.project(projectId);
        if (this.active.has(project.path) || this.editing.has(project.path)) throw new Error('Stop the project tasks before changing this project');
        if (method === 'deleteProject') this.store.deleteProject(projectId);
        else for (const s of this.store.listSessions().filter(s => s.projectId === projectId)) { this.paused.add(s.id); this.store.updateSession(s.id, { archived: true }); }
        this.changed(); return null;
      }
      case 'rewind': return this.rewind(args as Requests['rewind']);
      case 'createSession': { const a = args as Requests['createSession']; const s = this.store.createSession(a.projectId, a.provider); this.changed(); return s; }
      case 'updateSession': {
        const { id, draftAttachments, ...patch } = args as Requests['updateSession'];
        if ([...this.active.values()].some(run => run.session.id === id) && (patch.archived || patch.model !== undefined || patch.effort !== undefined || patch.mode !== undefined)) throw new Error('Stop this task before changing its execution settings');
        if (patch.archived) this.paused.add(id);
        const s = this.store.updateSession(id, { ...patch, ...(draftAttachments ? { draftAttachments: await this.attachments.resolve(draftAttachments) } : {}) }); if (patch.draft === undefined) this.changed(); return s;
      }
      case 'messages': { const a = args as Requests['messages']; return this.store.page(a.sessionId, a.before); }
      case 'send': {
        const a = args as Requests['send']; const s = this.store.session(a.sessionId);
        if (this.editing.has(this.store.project(s.projectId).path)) throw new Error('Please wait for the history operation to finish');
        if (s.archived) throw new Error('Restore this session before sending a message');
        const item = this.store.enqueue(s.id, a.text, await this.attachments.resolve(a.attachments), a.context); this.paused.delete(s.id);
        if (![...this.active.values()].some(run => run.session.id === s.id)) this.store.updateSession(s.id, { status: 'queued' });
        this.changed(); void this.drain(); return item;
      }
      case 'stop': { await this.stop((args as Requests['stop']).sessionId); return null; }
      case 'queue': return this.store.queued((args as Requests['queue']).sessionId);
      case 'resumeQueue': { this.paused.delete((args as Requests['resumeQueue']).sessionId); void this.drain(); return null; }
      case 'updateQueue': { const a = args as Requests['updateQueue']; this.store.updateQueue(a.id, a.text, a.remove); this.changed(); return null; }
      case 'respond': {
        const a = args as Requests['respond'];
        const run = [...this.active.values()].find(run => run.session.id === a.sessionId);
        const row = run?.rows.get(a.messageId);
        if (!run || !row || row.state !== 'pending' || run.cancelled) throw new Error('This request is no longer active');
        if (row.questions?.some(q => !a.answers?.[q.id]?.trim())) throw new Error('Answer each question before continuing');
        run.adapter.respond(a.messageId.slice(run.id.length + 1), a.choice, a.answers);
        row.state = 'resolved'; row.seq = ++run.seq; run.dirty.add(row.id);
        this.store.updateSession(run.session.id, { status: [...run.rows.values()].some(row => row.state === 'pending') ? 'waiting' : 'running' });
        this.flush(); this.changed(); return null;
      }
      case 'providers': return this.providers((args as Requests['providers']).refresh);
      case 'settings': { this.providerCache = undefined; const s = this.store.setSettings(args as Requests['settings']); this.changed(); return s; }
      case 'gitStatus': return gitStatus(this.store.project((args as Requests['gitStatus']).projectId).path);
      case 'gitDiff': { const a = args as Requests['gitDiff']; return gitDiff(this.store.project(a.projectId).path, a.path, a.area); }
      default: throw new Error(`Operation is not available in the runtime: ${method}`);
    }
  }
  private draining = false;
  private drainAgain = false;
  private async drain() {
    if (this.stopping) return;
    if (this.draining) { this.drainAgain = true; return; }
    this.draining = true;
    try {
      for (const item of this.store.queued()) {
        if (this.stopping || this.paused.has(item.sessionId)) continue;
        const session = this.store.listSessions().find(s => s.id === item.sessionId);
        if (!session) continue;
        const project = this.store.project(session.projectId);
        if (session.archived || this.active.has(project.path) || this.editing.has(project.path)) continue;
        let path: string;
        try { path = await this.providerPath(session.provider); }
        catch (error) { this.paused.add(session.id); this.store.updateSession(session.id, { status: 'failed' }); this.store.saveMessage({ id: randomUUID(), runId: randomUUID(), sessionId: session.id, seq: 1, kind: 'error', text: error instanceof Error ? error.message : String(error), title: '', state: 'error', createdAt: Date.now() }); this.changed(); continue; }
        if (this.stopping) break;
        if (this.editing.has(project.path) || !this.store.listSessions().some(s => s.id === session.id && !s.archived) || this.paused.has(session.id) || !this.store.queued(session.id).some(queued => queued.id === item.id)) continue;
        const run: Active = { id: randomUUID(), session, adapter: this.adapterFactory(session.provider, path), seq: 1, cancelled: false, rows: new Map(), dirty: new Set() };
        this.active.set(project.path, run);
        this.emit({ type: 'message', message: this.store.begin(item, run.id) }); this.changed();
        run.promise = this.execute(run, project.path, item.text, item.attachments || [], item.context);
      }
    } finally {
      this.draining = false;
      if (this.drainAgain) { this.drainAgain = false; queueMicrotask(() => { void this.drain(); }); }
    }
  }
  private accept(run: Active, event: AgentEvent) {
    if (run.cancelled || this.stopping) return;
    const id = `${run.id}:${event.key}`, existing = run.rows.get(id);
    const row: Omit<Message, 'position'> = existing || { id, sessionId: run.session.id, runId: run.id, seq: 0, kind: event.kind, text: '', title: '', state: 'running', createdAt: Date.now() };
    row.seq = ++run.seq;
    if (event.text !== undefined) row.text = event.text.slice(0, 500_000);
    if (event.delta) row.text = (row.text + event.delta).slice(0, 500_000);
    if (event.title !== undefined) row.title = event.title;
    if (event.state) row.state = event.state;
    if (event.choices) row.choices = event.choices;
    if (event.questions) row.questions = event.questions;
    run.rows.set(id, row); run.dirty.add(id);
    if (row.state === 'pending') { this.store.updateSession(run.session.id, { status: 'waiting' }); this.flush(); this.changed(); }
  }
  private flush() {
    for (const run of this.active.values()) for (const id of run.dirty) {
      const row = run.rows.get(id)!;
      this.emit({ type: 'message', message: this.store.saveMessage(row) });
      run.dirty.delete(id);
    }
  }
  private async execute(run: Active, path: string, text: string, attachments: import('../shared/types').Attachment[], context?: import('../shared/types').PromptContext) {
    let failed = false;
    try {
      await run.adapter.run({ session: run.session, cwd: path, text: run.session.historySeed && !run.session.nativeId ? `${run.session.historySeed}\n\nCurrent user message:\n${text}` : text, promptContext: context, selection: await this.catalog.resolve(path, context), attachments: await agentAttachments(this.attachments, attachments), turnId: id => this.store.setTurnId(run.id, id), emit: event => this.accept(run, event), nativeId: nativeId => { this.store.updateSession(run.session.id, { nativeId }); this.changed(); } });
    } catch (error) {
      if (!run.cancelled && !this.stopping) { failed = true; this.paused.add(run.session.id); this.accept(run, { key: 'error', kind: 'error', text: providerError(error), state: 'error' }); }
    } finally {
      await run.adapter.close();
      for (const row of run.rows.values()) {
        if (row.state === 'pending' || row.state === 'running') { row.state = row.state === 'pending' || failed || run.cancelled ? 'expired' : 'done'; row.seq = ++run.seq; run.dirty.add(row.id); }
      }
      this.flush(); this.active.delete(path);
      this.store.updateSession(run.session.id, { status: run.cancelled ? 'cancelled' : failed ? 'failed' : 'completed' });
      this.changed(); queueMicrotask(() => { void this.drain(); });
    }
  }
  private async rewind({ sessionId, messageId, edit }: Requests['rewind']) {
    const source = this.store.session(sessionId), project = this.store.project(source.projectId);
    if (this.active.has(project.path) || this.editing.has(project.path)) throw new Error('Stop project tasks before returning to an earlier message');
    this.editing.add(project.path);
    let adapter: AgentAdapter | undefined;
    try {
      const all = this.store.allMessages(sessionId), target = all.find(m => m.id === messageId);
      if (!target || !['user', 'assistant'].includes(target.kind)) throw new Error('Choose a conversation message');
      if (edit && target.kind !== 'user') throw new Error('Only your messages can be edited');
      const start = all.find(m => m.runId === target.runId && m.kind === 'user') || target;
      const end = all.filter(m => m.runId === target.runId).at(-1) || target;
      const retained = all.filter(m => target.kind === 'user' ? m.position < start.position : m.position <= end.position);
      let nativeId: string | null = null;
      const lastUser = retained.filter(m => m.kind === 'user').at(-1);
      if (source.provider === 'codex' && source.nativeId && lastUser?.nativeTurnId) {
        adapter = this.adapterFactory(source.provider, await this.providerPath(source.provider));
        this.probing.add(adapter);
        if (adapter.fork) nativeId = await adapter.fork(source, project.path, lastUser.nativeTurnId);
      }
      const historySeed = nativeId || !retained.length ? '' : 'Earlier conversation restored by Moose. Treat this as conversation history, not a request to repeat completed work. Workspace files have NOT been reverted.\n' + retained.filter(m => ['user', 'assistant', 'tool'].includes(m.kind)).map(m => `${m.kind}: ${m.text}${m.attachments?.length ? '\nAttachments: ' + m.attachments.map(a => this.attachments.path(a)).join(', ') : ''}`).join('\n\n');
      if (historySeed.length > 500_000) throw new Error('This history is too large to restore without a native checkpoint. Choose a more recent session.');
      if (this.stopping) throw new Error('Moose is shutting down');
      const result = this.store.branch(source, retained, target.kind === 'user' ? target.text : '', target.kind === 'user' ? target.attachments || [] : [], nativeId, historySeed);
      this.changed(); return result;
    } finally { await adapter?.close(); if (adapter) this.probing.delete(adapter); this.editing.delete(project.path); void this.drain(); }
  }
  async stop(sessionId: string) {
    this.paused.add(sessionId);
    const run = [...this.active.values()].find(run => run.session.id === sessionId);
    if (run) { run.cancelled = true; await run.adapter.cancel(); await run.adapter.close(); await run.promise; }
    else this.store.updateSession(sessionId, { status: 'cancelled' });
    this.changed();
  }
  async close() {
    this.stopping = true;
    await Promise.all([...this.probing].map(adapter => adapter.close()));
    await this.probePromise?.catch(() => {});
    await Promise.all([...this.active.values()].map(async run => { run.cancelled = true; await run.adapter.cancel(); await run.adapter.close(); await run.promise; }));
    clearInterval(this.flushTimer); this.flush(); this.store.close();
  }
}
