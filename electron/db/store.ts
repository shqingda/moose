import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as table from './schema';
import { migrate } from './migrations';
import {
  defaultSettings,
  type Attachment,
  type Message,
  type Project,
  type Provider,
  type QueueItem,
  type Session,
  type Settings,
} from '../../shared/types';

export class Store {
  readonly sqlite: Database.Database;
  readonly db;
  /** 打开 SQLite、执行迁移，并把上次退出时未完成的任务和审批标记为中断或失效。 */
  constructor(filename: string) {
    this.sqlite = new Database(filename);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('foreign_keys = ON');
    migrate(this.sqlite);
    this.db = drizzle(this.sqlite);
    this.db
      .update(table.sessions)
      .set({ status: 'interrupted' })
      .where(inArray(table.sessions.status, ['running', 'waiting', 'queued']))
      .run();
    this.db
      .update(table.messages)
      .set({ state: 'expired' })
      .where(inArray(table.messages.state, ['pending', 'running']))
      .run();
  }
  /** 按加入时间倒序读取项目列表。 */
  listProjects(): Project[] {
    return this.db.select().from(table.projects).orderBy(desc(table.projects.createdAt)).all();
  }
  /** 按 ID 读取项目；不存在时明确报错，避免后续使用无效目录。 */
  project(id: string): Project {
    const p = this.db.select().from(table.projects).where(eq(table.projects.id, id)).get();
    if (!p) throw new Error('Project not found');
    return p;
  }
  /** 按唯一目录路径复用已有项目，否则创建新的本地项目记录。 */
  addProject(path: string): Project {
    const existing = this.db
      .select()
      .from(table.projects)
      .where(eq(table.projects.path, path))
      .get();
    if (existing) return existing;
    const project = { id: randomUUID(), name: basename(path) || path, path, createdAt: Date.now() };
    this.db.insert(table.projects).values(project).run();
    return project;
  }
  /** 按更新时间倒序返回所有会话，归档过滤由调用方决定。 */
  listSessions(): Session[] {
    return this.db
      .select()
      .from(table.sessions)
      .orderBy(desc(table.sessions.updatedAt))
      .all() as Session[];
  }
  /** 读取指定会话，不存在时抛错。 */
  session(id: string): Session {
    const s = this.db.select().from(table.sessions).where(eq(table.sessions.id, id)).get();
    if (!s) throw new Error('Session not found');
    return s as Session;
  }
  /** 创建绑定项目与 provider 的本地会话，代理端会话在首次执行时再创建。 */
  createSession(projectId: string, provider: Provider): Session {
    this.project(projectId);
    const s: Session = {
      id: randomUUID(),
      projectId,
      provider,
      title: '',
      archived: false,
      nativeId: null,
      model: '',
      effort: '',
      mode: '',
      draft: '',
      status: 'idle',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.db.insert(table.sessions).values(s).run();
    return s;
  }
  /** 更新会话可变字段及更新时间，返回更新后的记录。 */
  updateSession(
    id: string,
    patch: Partial<Omit<Session, 'id' | 'projectId' | 'provider' | 'createdAt'>>,
  ) {
    this.session(id);
    this.db
      .update(table.sessions)
      .set({ ...patch, updatedAt: Date.now() })
      .where(eq(table.sessions.id, id))
      .run();
    return this.session(id);
  }
  /** 合并默认值与已保存配置，让旧数据库兼容新增设置。 */
  getSettings(): Settings {
    const row = this.db.select().from(table.settings).where(eq(table.settings.key, 'app')).get();
    return { ...defaultSettings, ...(row ? JSON.parse(row.value) : {}) };
  }
  /** 合并并持久化应用设置，未传入的字段保持原值。 */
  setSettings(patch: Partial<Settings>): Settings {
    const value = { ...this.getSettings(), ...patch };
    this.db
      .insert(table.settings)
      .values({ key: 'app', value: JSON.stringify(value) })
      .onConflictDoUpdate({ target: table.settings.key, set: { value: JSON.stringify(value) } })
      .run();
    return value;
  }
  /** 按消息 ID 更新记录；seq 不增加时拒绝覆盖，保持流式更新顺序。 */
  saveMessage(message: Omit<Message, 'position'>): Message {
    const { choices, questions, attachments, nativeTurnId, context, ...data } = message;
    const row = {
      ...data,
      details: JSON.stringify({ choices, questions, attachments, nativeTurnId, context }),
    };
    const existing = this.db
      .select()
      .from(table.messages)
      .where(eq(table.messages.id, message.id))
      .get();
    if (existing && existing.seq >= message.seq) return this.decode(existing);
    this.db
      .insert(table.messages)
      .values(row)
      .onConflictDoUpdate({ target: table.messages.id, set: row })
      .run();
    return this.decode(
      this.db.select().from(table.messages).where(eq(table.messages.id, message.id)).get()!,
    );
  }
  /** 把 details JSON 中的附件、审批与上下文字段还原为 Message。 */
  private decode(row: typeof table.messages.$inferSelect): Message {
    const { details, ...data } = row;
    return { ...data, ...JSON.parse(details) } as Message;
  }
  /** 按 position 游标向前分页，每页 80 条，额外读取一条判断是否还有历史。 */
  page(sessionId: string, before?: number) {
    this.session(sessionId);
    const rows = this.db
      .select()
      .from(table.messages)
      .where(
        and(
          eq(table.messages.sessionId, sessionId),
          before ? lt(table.messages.position, before) : undefined,
        ),
      )
      .orderBy(desc(table.messages.position))
      .limit(81)
      .all();
    return {
      hasMore: rows.length > 80,
      messages: rows
        .slice(0, 80)
        .reverse()
        .map((row) => this.decode(row)),
    };
  }
  /** 先把待发消息和上下文写入磁盘，实际启动由 Service 调度。 */
  enqueue(
    sessionId: string,
    text: string,
    attachments: Attachment[] = [],
    context?: import('../../shared/types').PromptContext,
  ): QueueItem {
    this.session(sessionId);
    const item = { id: randomUUID(), sessionId, text, attachments, context, createdAt: Date.now() };
    this.db.insert(table.queue).values(item).run();
    return item;
  }
  /** 读取全局或指定会话队列；同时间戳用 rowid 保持入队顺序。 */
  queued(sessionId?: string): QueueItem[] {
    return this.db
      .select()
      .from(table.queue)
      .where(sessionId ? eq(table.queue.sessionId, sessionId) : undefined)
      .orderBy(asc(table.queue.createdAt), asc(sql`${table.queue}.rowid`))
      .all() as QueueItem[];
  }
  /** 修改尚未执行的文本，或移除指定队列项。 */
  updateQueue(id: string, text?: string, remove = false) {
    if (remove) this.db.delete(table.queue).where(eq(table.queue.id, id)).run();
    else if (text) this.db.update(table.queue).set({ text }).where(eq(table.queue.id, id)).run();
  }
  /** 在一个事务中出队、标记运行并保存用户消息，避免只完成其中一步。 */
  begin(item: QueueItem, runId: string) {
    return this.sqlite.transaction(() => {
      this.updateQueue(item.id, undefined, true);
      const s = this.session(item.sessionId);
      this.updateSession(s.id, {
        status: 'running',
        ...(s.title
          ? {}
          : {
              title: (
                item.text.replace(/\s+/g, ' ') ||
                item.attachments?.[0]?.name ||
                'New conversation'
              ).slice(0, 70),
            }),
      });
      return this.saveMessage({
        id: randomUUID(),
        sessionId: s.id,
        runId,
        seq: 1,
        kind: 'user',
        text: item.text,
        context: item.context,
        attachments: item.attachments,
        title: '',
        state: 'done',
        createdAt: Date.now(),
      });
    })();
  }
  /** 读取完整会话历史，用于整轮复制和编辑时重建上下文。 */
  allMessages(sessionId: string): Message[] {
    this.session(sessionId);
    return this.db
      .select()
      .from(table.messages)
      .where(eq(table.messages.sessionId, sessionId))
      .orderBy(asc(table.messages.position))
      .all()
      .map((row) => this.decode(row));
  }
  /** 把代理原生 turn ID 绑定到本轮用户消息，供后续编辑恢复上下文。 */
  setTurnId(runId: string, nativeTurnId: string) {
    const row = this.db
      .select()
      .from(table.messages)
      .where(and(eq(table.messages.runId, runId), eq(table.messages.kind, 'user')))
      .get();
    if (row) this.saveMessage({ ...this.decode(row), nativeTurnId, seq: row.seq + 1 });
  }
  /** 仅允许删除已归档会话，事务内同时清理消息与队列。 */
  deleteSession(sessionId: string) {
    if (!this.session(sessionId).archived)
      throw new Error('Archive the conversation before deleting it');
    this.sqlite.transaction(() => {
      this.db.delete(table.queue).where(eq(table.queue.sessionId, sessionId)).run();
      this.db.delete(table.messages).where(eq(table.messages.sessionId, sessionId)).run();
      this.db.delete(table.sessions).where(eq(table.sessions.id, sessionId)).run();
    })();
  }
  /** 删除项目及关联会话数据；不会删除真实工作目录中的文件。 */
  deleteProject(projectId: string) {
    this.project(projectId);
    this.sqlite.transaction(() => {
      for (const session of this.listSessions().filter((s) => s.projectId === projectId)) {
        this.db.delete(table.queue).where(eq(table.queue.sessionId, session.id)).run();
        this.db.delete(table.messages).where(eq(table.messages.sessionId, session.id)).run();
        this.db.delete(table.sessions).where(eq(table.sessions.id, session.id)).run();
      }
      this.db.delete(table.projects).where(eq(table.projects.id, projectId)).run();
    })();
  }
  /** 原子替换最后一轮记录并重新入队，沿用原 Moose 会话 ID。 */
  replaceLastTurn(
    sessionId: string,
    position: number,
    nativeId: string | null,
    historySeed: string,
    text: string,
    attachments: Attachment[],
    context?: import('../../shared/types').PromptContext,
  ) {
    this.sqlite.transaction(() => {
      this.sqlite
        .prepare('DELETE FROM messages WHERE session_id = ? AND position >= ?')
        .run(sessionId, position);
      this.updateSession(sessionId, { nativeId, historySeed, status: 'queued' });
      this.enqueue(sessionId, text, attachments, context);
    })();
  }
  /** 关闭 SQLite 连接；调用前应已停止所有后台写入。 */
  close() {
    this.sqlite.close();
  }
}
