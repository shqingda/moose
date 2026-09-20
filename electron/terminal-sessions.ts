import { hostname, userInfo } from 'node:os';
import { TerminalControls } from './terminal-control';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { Store } from './db/store';
import { agentEnvironment } from './providers/process';
import type { TerminalSession, TerminalRequests, TerminalOutput } from '../shared/terminal';
interface Record extends TerminalSession {
  output: string;
  offset: number;
}
interface Active {
  record: Record;
  child: ChildProcessWithoutNullStreams;
  done: Promise<void>;
  stopping?: 'cancelled' | 'interrupted';
  dirty: boolean;
  publishedOffset: number;
}
const limit = 1024 * 1024;
/** PTY output uses absolute offsets so reconnects can replay retained output without guessing. */
export class TerminalSessions {
  private active = new Map<string, Active>();
  private closed = false;
  private controls: TerminalControls;
  private timer: ReturnType<typeof setInterval>;
  private streamTimer: ReturnType<typeof setInterval>;
  constructor(
    private store: Store,
    private lock: (cwd: string) => () => void,
    private emit: (output: TerminalOutput) => void = () => {},
    controlChanged: (id: string) => void = () => {},
  ) {
    this.controls = new TerminalControls(controlChanged);
    for (const record of this.records())
      if (record.status === 'running') {
        record.status = 'unknown';
        this.save(record);
      }
    this.timer = setInterval(() => {
      for (const item of this.active.values())
        if (item.dirty) {
          this.save(item.record);
          item.dirty = false;
        }
    }, 500);
    this.timer.unref();
    this.streamTimer = setInterval(() => {
      for (const item of this.active.values())
        if (item.publishedOffset !== item.record.offset) this.publish(item);
    }, 33);
    this.streamTimer.unref();
  }
  private publish(item: Active) {
    const update = this.read({ id: item.record.id, offset: item.publishedOffset });
    item.publishedOffset = update.offset;
    this.emit(update);
  }
  private records(): Record[] {
    return (
      this.store.sqlite.prepare("SELECT value FROM settings WHERE key LIKE 'terminal:%'").all() as {
        value: string;
      }[]
    ).map((row) => JSON.parse(row.value));
  }
  private save(record: Record) {
    this.store.sqlite
      .prepare(
        'INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(`terminal:${record.id}`, JSON.stringify(record));
  }
  private get(id: string): Record {
    const live = this.active.get(id);
    if (live) return live.record;
    const row = this.store.sqlite
      .prepare('SELECT value FROM settings WHERE key=?')
      .get(`terminal:${id}`) as { value: string } | undefined;
    if (!row) throw new Error('Terminal not found');
    return JSON.parse(row.value);
  }
  private summary({ output: _output, offset: _offset, ...session }: Record): TerminalSession {
    return session;
  }
  list(projectId: string) {
    this.store.project(projectId);
    return [...this.active.values()]
      .filter((item) => item.record.projectId === projectId && item.record.status === 'running')
      .map((item) => this.summary(item.record));
  }

  read({ id, offset }: TerminalRequests['terminalRead']): TerminalOutput {
    const record = this.get(id),
      start = record.offset - record.output.length;
    const reset = offset < start || offset > record.offset;
    return {
      session: this.summary(record),
      data: record.output.slice(reset ? 0 : offset - start),
      offset: record.offset,
      reset,
    };
  }
  async start(args: TerminalRequests['terminalStart']) {
    if (this.closed) throw new Error('Moose is shutting down');
    const existing = this.store.sqlite
      .prepare('SELECT value FROM settings WHERE key=?')
      .get(`terminal:${args.requestId}`) as { value: string } | undefined;
    if (existing) {
      const record: Record = JSON.parse(existing.value);
      if (record.projectId !== args.projectId || record.sessionId !== args.sessionId)
        throw new Error('Request ID already used');
      return this.summary(this.active.get(record.id)?.record || record);
    }
    const cwd = this.store.directory(args.projectId, args.sessionId),
      unlock = this.lock(cwd);
    const record: Record = {
      id: args.requestId,
      projectId: args.projectId,
      sessionId: args.sessionId,
      cwd,
      title: `${userInfo().username}@${hostname().replace(/\.local$/, '')}`,
      status: 'running',
      createdAt: Date.now(),
      exitCode: null,
      cols: args.cols,
      rows: args.rows,
      output: '',
      offset: 0,
    };
    let child: ChildProcessWithoutNullStreams;
    try {
      this.save(record);
      child = spawn(
        process.execPath,
        [fileURLToPath(new URL(/* @vite-ignore */ '../pty-host/pty-host.js', import.meta.url))],
        {
          cwd,
          env: { ...agentEnvironment(), ELECTRON_RUN_AS_NODE: '1' },
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
    } catch (error) {
      record.status = 'failed';
      this.save(record);
      unlock();
      throw error;
    }
    let finish!: () => void;
    const active: Active = {
      record,
      child,
      dirty: false,
      publishedOffset: 0,
      done: new Promise((resolve) => {
        finish = resolve;
      }),
    };
    this.active.set(record.id, active);
    let ready!: () => void, failed!: (error: Error) => void;
    const started = new Promise<void>((resolve, reject) => {
      ready = resolve;
      failed = reject;
    });
    const timeout = setTimeout(() => {
      failed(new Error('Terminal startup timed out'));
      child.stdin.end();
    }, 10000);
    child.stdin.on('error', () => {});
    child.stderr.resume();
    child.once('error', () => {
      failed(new Error('Unable to start terminal'));
    });
    createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        const event = JSON.parse(line);
        if (event.type === 'ready') {
          clearTimeout(timeout);
          ready();
        } else if (event.type === 'data' && typeof event.data === 'string') {
          record.output = (record.output + event.data).slice(-limit);
          record.offset += event.data.length;
          active.dirty = true;
        } else if (event.type === 'exit') record.exitCode = event.exitCode;
        else if (event.type === 'error') {
          record.status = 'failed';
          failed(new Error('Terminal process failed'));
        }
      } catch {
        /* Only the owned helper writes this channel. */
      }
    });
    child.once('close', () => {
      clearTimeout(timeout);
      record.status =
        active.stopping ||
        (record.exitCode === 0 ? 'completed' : record.exitCode === null ? 'unknown' : 'failed');
      this.save(record);
      this.store.sqlite
        .prepare(`UPDATE settings SET value=json_set(value,'$.output','')
        WHERE key LIKE 'terminal:%' AND json_extract(value,'$.projectId')=? AND json_extract(value,'$.status')!='running'
        AND key NOT IN (SELECT key FROM settings WHERE key LIKE 'terminal:%' AND json_extract(value,'$.projectId')=?
        ORDER BY json_extract(value,'$.createdAt') DESC LIMIT 30)`)
        .run(record.projectId, record.projectId);
      this.publish(active);
      this.active.delete(record.id);
      this.controls.remove(record.id);
      unlock();
      finish();
      failed(new Error('Terminal exited before startup completed'));
    });
    this.send(active, { type: 'start', cwd, cols: args.cols, rows: args.rows });
    try {
      await started;
      return this.summary(record);
    } catch (error) {
      await this.stop(record.id);
      throw error;
    }
  }
  private send(active: Active, value: object) {
    if (active.child.stdin.destroyed || active.child.stdin.writableEnded)
      throw new Error('Terminal input is closed');
    if (active.child.stdin.writableLength > 128 * 1024) throw new Error('Terminal input is busy');
    active.child.stdin.write(JSON.stringify(value) + '\n');
  }
  control(args: TerminalRequests['terminalControl'], client: string) {
    const active = this.active.get(args.id);
    if (!active || active.stopping) throw new Error('Terminal is no longer running');
    return this.controls.update(args, client);
  }
  input({ id, text, lease }: TerminalRequests['terminalInput'], client = 'local') {
    const active = this.active.get(id);
    if (!active || active.stopping) throw new Error('Terminal is no longer running');
    this.controls.assert(id, client, lease);
    this.send(active, { type: 'input', text });
  }
  resize({ id, cols, rows, lease }: TerminalRequests['terminalResize'], client = 'local') {
    const active = this.active.get(id);
    if (!active || active.stopping) return;
    this.controls.assert(id, client, lease);
    this.send(active, { type: 'resize', cols, rows });
    active.record.cols = cols;
    active.record.rows = rows;
    active.dirty = true;
    this.publish(active);
  }
  async stop(id: string, status: 'cancelled' | 'interrupted' = 'cancelled') {
    const active = this.active.get(id);
    if (!active) {
      this.get(id);
      return;
    }
    active.stopping ||= status;
    active.child.stdin.end(); // EOF is also the runtime-crash cleanup protocol.
    const timeout = setTimeout(() => active.child.kill('SIGTERM'), 3000);
    try {
      await active.done;
    } finally {
      clearTimeout(timeout);
    }
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    clearInterval(this.streamTimer);
    await Promise.all([...this.active.keys()].map((id) => this.stop(id, 'interrupted')));
  }
}
