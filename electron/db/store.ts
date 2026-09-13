import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as table from './schema';
import { migrate } from './migrations';
import { defaultSettings, type Attachment, type Message, type Project, type Provider, type QueueItem, type Session, type Settings } from '../../shared/types';

export class Store {
  readonly sqlite: Database.Database;
  readonly db;
  constructor(filename: string) {
    this.sqlite = new Database(filename);
    this.sqlite.pragma('journal_mode = WAL'); this.sqlite.pragma('foreign_keys = ON');
    migrate(this.sqlite);
    this.db = drizzle(this.sqlite);
    this.db.update(table.sessions).set({ status: 'interrupted' }).where(inArray(table.sessions.status, ['running', 'waiting', 'queued'])).run();
    this.db.update(table.messages).set({ state: 'expired' }).where(inArray(table.messages.state, ['pending', 'running'])).run();
  }
  listProjects(): Project[] { return this.db.select().from(table.projects).orderBy(desc(table.projects.createdAt)).all(); }
  project(id: string): Project { const p = this.db.select().from(table.projects).where(eq(table.projects.id, id)).get(); if (!p) throw new Error('Project not found'); return p; }
  addProject(path: string): Project {
    const existing = this.db.select().from(table.projects).where(eq(table.projects.path, path)).get();
    if (existing) return existing;
    const project = { id: randomUUID(), name: basename(path) || path, path, createdAt: Date.now() };
    this.db.insert(table.projects).values(project).run(); return project;
  }
  listSessions(): Session[] { return this.db.select().from(table.sessions).orderBy(desc(table.sessions.updatedAt)).all() as Session[]; }
  session(id: string): Session { const s = this.db.select().from(table.sessions).where(eq(table.sessions.id, id)).get(); if (!s) throw new Error('Session not found'); return s as Session; }
  createSession(projectId: string, provider: Provider): Session {
    this.project(projectId);
    const s: Session = { id: randomUUID(), projectId, provider, title: '', archived: false, nativeId: null, model: '', effort: '', mode: '', draft: '', status: 'idle', createdAt: Date.now(), updatedAt: Date.now() };
    this.db.insert(table.sessions).values(s).run(); return s;
  }
  updateSession(id: string, patch: Partial<Omit<Session, 'id' | 'projectId' | 'provider' | 'createdAt'>>) {
    this.session(id);
    this.db.update(table.sessions).set({ ...patch, updatedAt: Date.now() }).where(eq(table.sessions.id, id)).run(); return this.session(id);
  }
  getSettings(): Settings { const row = this.db.select().from(table.settings).where(eq(table.settings.key, 'app')).get(); return { ...defaultSettings, ...(row ? JSON.parse(row.value) : {}) }; }
  setSettings(patch: Partial<Settings>): Settings {
    const value = { ...this.getSettings(), ...patch };
    this.db.insert(table.settings).values({ key: 'app', value: JSON.stringify(value) }).onConflictDoUpdate({ target: table.settings.key, set: { value: JSON.stringify(value) } }).run(); return value;
  }
  saveMessage(message: Omit<Message, 'position'>): Message {
    const { choices, questions, attachments, nativeTurnId, context, ...data } = message;
    const row = { ...data, details: JSON.stringify({ choices, questions, attachments, nativeTurnId, context }) };
    const existing = this.db.select().from(table.messages).where(eq(table.messages.id, message.id)).get();
    if (existing && existing.seq >= message.seq) return this.decode(existing);
    this.db.insert(table.messages).values(row).onConflictDoUpdate({ target: table.messages.id, set: row }).run();
    return this.decode(this.db.select().from(table.messages).where(eq(table.messages.id, message.id)).get()!);
  }
  private decode(row: typeof table.messages.$inferSelect): Message { const { details, ...data } = row; return { ...data, ...JSON.parse(details) } as Message; }
  page(sessionId: string, before?: number) {
    this.session(sessionId);
    const rows = this.db.select().from(table.messages).where(and(eq(table.messages.sessionId, sessionId), before ? lt(table.messages.position, before) : undefined)).orderBy(desc(table.messages.position)).limit(81).all();
    return { hasMore: rows.length > 80, messages: rows.slice(0, 80).reverse().map(row => this.decode(row)) };
  }
  enqueue(sessionId: string, text: string, attachments: Attachment[] = [], context?: import('../../shared/types').PromptContext): QueueItem {
    this.session(sessionId); const item = { id: randomUUID(), sessionId, text, attachments, context, createdAt: Date.now() };
    this.db.insert(table.queue).values(item).run(); return item;
  }
  queued(sessionId?: string): QueueItem[] { return this.db.select().from(table.queue).where(sessionId ? eq(table.queue.sessionId, sessionId) : undefined).orderBy(asc(table.queue.createdAt), asc(sql`${table.queue}.rowid`)).all() as QueueItem[]; }
  updateQueue(id: string, text?: string, remove = false) {
    if (remove) this.db.delete(table.queue).where(eq(table.queue.id, id)).run();
    else if (text) this.db.update(table.queue).set({ text }).where(eq(table.queue.id, id)).run();
  }
  begin(item: QueueItem, runId: string) {
    return this.sqlite.transaction(() => {
      this.updateQueue(item.id, undefined, true);
      const s = this.session(item.sessionId);
      this.updateSession(s.id, { status: 'running', ...(s.title ? {} : { title: (item.text.replace(/\s+/g, ' ') || item.attachments?.[0]?.name || 'New conversation').slice(0, 70) }) });
      return this.saveMessage({ id: randomUUID(), sessionId: s.id, runId, seq: 1, kind: 'user', text: item.text, context: item.context, attachments: item.attachments,  title: '', state: 'done', createdAt: Date.now() });
    })();
  }
  allMessages(sessionId: string): Message[] { this.session(sessionId); return this.db.select().from(table.messages).where(eq(table.messages.sessionId, sessionId)).orderBy(asc(table.messages.position)).all().map(row => this.decode(row)); }
  setTurnId(runId: string, nativeTurnId: string) {
    const row = this.db.select().from(table.messages).where(and(eq(table.messages.runId, runId), eq(table.messages.kind, 'user'))).get();
    if (row) this.saveMessage({ ...this.decode(row), nativeTurnId, seq: row.seq + 1 });
  }
  deleteSession(sessionId: string) {
    if (!this.session(sessionId).archived) throw new Error('Archive the conversation before deleting it');
    this.sqlite.transaction(() => {
      this.db.delete(table.queue).where(eq(table.queue.sessionId, sessionId)).run();
      this.db.delete(table.messages).where(eq(table.messages.sessionId, sessionId)).run();
      this.db.delete(table.sessions).where(eq(table.sessions.id, sessionId)).run();
    })();
  }
  deleteProject(projectId: string) {
    this.project(projectId);
    this.sqlite.transaction(() => {
      for (const session of this.listSessions().filter(s => s.projectId === projectId)) {
        this.db.delete(table.queue).where(eq(table.queue.sessionId, session.id)).run();
        this.db.delete(table.messages).where(eq(table.messages.sessionId, session.id)).run();
        this.db.delete(table.sessions).where(eq(table.sessions.id, session.id)).run();
      }
      this.db.delete(table.projects).where(eq(table.projects.id, projectId)).run();
    })();
  }
  replaceLastTurn(sessionId: string, position: number, nativeId: string | null, historySeed: string, text: string, attachments: Attachment[], context?: import('../../shared/types').PromptContext) {
    this.sqlite.transaction(() => {
      this.sqlite.prepare('DELETE FROM messages WHERE session_id = ? AND position >= ?').run(sessionId, position);
      this.updateSession(sessionId, { nativeId, historySeed, status: 'queued' });
      this.enqueue(sessionId, text, attachments, context);
    })();
  }
  close() { this.sqlite.close(); }
}
