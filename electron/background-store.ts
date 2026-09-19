import type { Store } from './db/store';
import type { CommandJob, Schedule } from '../shared/background';
export type StoredSchedule = Schedule & { creationFingerprint?: string };
type Records = { command: CommandJob; schedule: StoredSchedule };
/** Background records share SQLite transactions with the normal agent queue. */
export class BackgroundStore {
  constructor(readonly store: Store) {}
  list<K extends keyof Records>(kind: K): Records[K][] {
    return (
      this.store.sqlite
        .prepare('SELECT value FROM settings WHERE key LIKE ?')
        .all(`background-${kind}:%`) as { value: string }[]
    ).map((row) => JSON.parse(row.value));
  }
  commandSummaries(): Omit<CommandJob, 'output'>[] {
    return (
      this.store.sqlite
        .prepare(
          "SELECT json_remove(value, '$.output') AS value FROM settings WHERE key LIKE 'background-command:%'",
        )
        .all() as { value: string }[]
    ).map((row) => JSON.parse(row.value));
  }
  trimCommandOutput(projectId: string) {
    this.store.sqlite
      .prepare(`UPDATE settings SET value=json_set(value,'$.output','','$.truncated',json('true'))
      WHERE key LIKE 'background-command:%' AND json_extract(value,'$.projectId')=? AND json_extract(value,'$.status')!='running'
      AND json_extract(value,'$.output')!='' AND key NOT IN (
        SELECT key FROM settings WHERE key LIKE 'background-command:%' AND json_extract(value,'$.projectId')=?
        ORDER BY json_extract(value,'$.createdAt') DESC LIMIT 100)`)
      .run(projectId, projectId);
  }
  get<K extends keyof Records>(kind: K, id: string): Records[K] | undefined {
    const row = this.store.sqlite
      .prepare('SELECT value FROM settings WHERE key=?')
      .get(`background-${kind}:${id}`) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }
  save<K extends keyof Records>(kind: K, value: Records[K]) {
    this.store.sqlite
      .prepare(
        'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(`background-${kind}:${value.id}`, JSON.stringify(value));
  }
}
