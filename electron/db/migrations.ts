import type Database from 'better-sqlite3';
/** 按 user_version 逐级执行事务迁移；遇到更高版本数据库时拒绝降级读取。 */
export function migrate(db: Database.Database) {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version > 3) throw new Error('This database was created by a newer Moose version.');
  if (version === 0)
    db.transaction(() => {
      db.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), provider TEXT NOT NULL, title TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, native_id TEXT, model TEXT NOT NULL DEFAULT '', effort TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL DEFAULT '', draft TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'idle', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE messages (position INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL REFERENCES sessions(id), run_id TEXT NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, title TEXT NOT NULL, state TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL);
      CREATE INDEX messages_session_position ON messages(session_id, position);
      CREATE TABLE queue (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), text TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      PRAGMA user_version = 1;
    `);
    })();
  if (version < 2)
    db.transaction(() => {
      db.exec(
        "ALTER TABLE sessions ADD COLUMN draft_attachments TEXT NOT NULL DEFAULT '[]'; ALTER TABLE sessions ADD COLUMN history_seed TEXT NOT NULL DEFAULT ''; ALTER TABLE queue ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'; PRAGMA user_version = 2;",
      );
    })();
  if (version < 3)
    db.transaction(() => {
      db.exec(
        'ALTER TABLE sessions ADD COLUMN draft_context TEXT; ALTER TABLE queue ADD COLUMN context TEXT; PRAGMA user_version = 3;',
      );
    })();
}
