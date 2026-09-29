import type { Store } from './db/store';
import type { Requests, Message } from '../shared/types';
import type { SearchHit } from '../shared/experience';

export function searchMessages(store: Store, args: Requests['searchMessages']) {
  if (args.projectId) store.project(args.projectId);
  if (args.sessionId) store.session(args.sessionId);
  const query = args.query.trim();
  const like = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  let cursor: [number, number, string] | undefined;
  if (args.cursor) {
    try {
      cursor = JSON.parse(args.cursor);
    } catch {
      throw new Error('Invalid search cursor');
    }
    if (
      !Array.isArray(cursor) ||
      cursor.length !== 3 ||
      !Number.isFinite(cursor[0]) ||
      !Number.isFinite(cursor[1]) ||
      typeof cursor[2] !== 'string'
    )
      throw new Error('Invalid search cursor');
  }
  const scope = `${args.projectId ? ' AND s.project_id=@projectId' : ''}${args.sessionId ? ' AND s.id=@sessionId' : ''}`;
  const rows = store.sqlite
    .prepare(`WITH hits AS (
    SELECT s.id sessionId, s.project_id projectId, p.name project, s.title, s.provider, s.archived,
      NULL messageId, 0 position, '' snippet, s.updated_at sortTime
    FROM sessions s JOIN projects p ON p.id=s.project_id
    WHERE s.title<>'' ${scope} AND (s.title LIKE @like ESCAPE '\\' OR p.name LIKE @like ESCAPE '\\')
    UNION ALL
    SELECT s.id, s.project_id, p.name, s.title, s.provider, s.archived,
      m.id, m.position, substr(m.title || ' ' || m.text, max(1,instr(lower(m.title || ' ' || m.text),lower(@query))-60),240), m.created_at
    FROM messages m JOIN sessions s ON s.id=m.session_id JOIN projects p ON p.id=s.project_id
    WHERE @query<>'' ${scope} AND (m.title LIKE @like ESCAPE '\\' OR m.text LIKE @like ESCAPE '\\')
  ) SELECT * FROM hits ${cursor ? 'WHERE (sortTime, position, sessionId)<(@time,@position,@sid)' : ''}
  ORDER BY sortTime DESC, position DESC, sessionId DESC LIMIT 51`)
    .all({
      query,
      like,
      ...(args.projectId ? { projectId: args.projectId } : {}),
      ...(args.sessionId ? { sessionId: args.sessionId } : {}),
      ...(cursor ? { time: cursor[0], position: cursor[1], sid: cursor[2] } : {}),
    }) as (Omit<SearchHit, 'archived'> & { archived: number; sortTime: number })[];
  const page = rows.slice(0, 50),
    last = page.at(-1);
  return {
    hits: page.map(({ sortTime, ...row }) => {
      void sortTime;
      return { ...row, archived: !!row.archived, messageId: row.messageId || undefined };
    }),
    cursor:
      rows.length > 50 && last
        ? JSON.stringify([last.sortTime, last.position, last.sessionId])
        : undefined,
  };
}
export function locateMessage(store: Store, { sessionId, messageId }: Requests['locateMessage']) {
  const target = store.message(messageId);
  if (!target || target.sessionId !== sessionId) throw new Error('Message no longer exists');
  const before = store.page(sessionId, target.position + 1);
  const after = store.sqlite
    .prepare('SELECT id FROM messages WHERE session_id=? AND position>? ORDER BY position LIMIT 81')
    .all(sessionId, target.position) as { id: string }[];
  return {
    messages: [...before.messages, ...after.slice(0, 80).map((row) => store.message(row.id)!)],
    hasMore: before.hasMore,
    hasLater: after.length > 80,
  };
}
export function pendingMessage(store: Store, sessionId: string): Message | undefined {
  const pending = store.sqlite
    .prepare(
      "SELECT id FROM messages WHERE session_id=? AND state='pending' AND kind IN ('approval','question') ORDER BY position LIMIT 1",
    )
    .get(sessionId) as { id: string } | undefined;
  if (pending) return store.message(pending.id);
  const row = store.sqlite
    .prepare(
      "SELECT id FROM messages WHERE session_id=? AND kind='plan' ORDER BY position DESC LIMIT 1",
    )
    .get(sessionId) as { id: string } | undefined;
  const plan = row && store.message(row.id);
  if (!plan || plan.state !== 'done' || !plan.text.trim() || !plan.plan || plan.plan.queueId)
    return;
  const user = store.sqlite
    .prepare(
      "SELECT run_id FROM messages WHERE session_id=? AND kind='user' AND (json_extract(details,'$.delivery.status') IS NULL OR json_extract(details,'$.delivery.status')='accepted') ORDER BY position DESC LIMIT 1",
    )
    .get(sessionId) as { run_id: string } | undefined;
  if (user?.run_id === plan.runId) return plan;
}
