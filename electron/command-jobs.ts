import { stripVTControlCharacters } from 'node:util';
import { spawnAgent, terminate, agentEnvironment } from './providers/process';
import { BackgroundStore } from './background-store';
import type { BackgroundRequests, CommandJob, JobStatus } from '../shared/background';
interface Active {
  job: CommandJob;
  child: ReturnType<typeof spawnAgent>;
  done: Promise<void>;
  dirty: boolean;
  stopping?: JobStatus;
}
const outputLimit = 128 * 1024;
/** Text command sessions owned by Moose, independent of provider tool processes. */
export class CommandJobs {
  private active = new Map<string, Active>();
  private closed = false;
  private timer: ReturnType<typeof setInterval>;
  constructor(
    private records: BackgroundStore,
    private lock: (cwd: string) => () => void,
  ) {
    for (const job of records.list('command'))
      if (job.status === 'running') {
        job.status = 'unknown';
        job.endedAt = Date.now();
        records.save('command', job);
      }
    this.timer = setInterval(() => this.flush(), 250);
    this.timer.unref();
  }
  list(projectId: string) {
    return this.records
      .commandSummaries()
      .filter((j) => j.projectId === projectId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100);
  }
  read(id: string) {
    const job = this.active.get(id)?.job || this.records.get('command', id);
    if (!job) throw new Error('Command not found');
    return job;
  }
  start(args: BackgroundRequests['commandStart']): CommandJob {
    if (this.closed) throw new Error('Moose is shutting down');
    const existing = this.records.get('command', args.requestId);
    if (existing) {
      if (
        existing.projectId !== args.projectId ||
        existing.sessionId !== args.sessionId ||
        existing.command !== args.command
      )
        throw new Error('Request ID already used');
      return this.active.get(existing.id)?.job || existing;
    }
    const cwd = this.records.store.directory(args.projectId, args.sessionId),
      unlock = this.lock(cwd);
    const job: CommandJob = {
      id: args.requestId,
      projectId: args.projectId,
      sessionId: args.sessionId,
      cwd,
      command: args.command,
      owner: 'moose',
      status: 'running',
      output: '',
      truncated: false,
      createdAt: Date.now(),
      exitCode: null,
      signal: null,
    };
    try {
      this.records.save('command', job);
      // FD 3 closes if the runtime dies; its watcher kills this owned process group.
      // The inner shell owns user jobs separately so its wait never waits on the watcher.
      const child = spawnAgent(
        '/bin/zsh',
        [
          '-c',
          '(read -r -u 3; kill -KILL -- -$$) & moose_watch=$!; ' +
            '/bin/zsh -c \'eval "$1"; moose_result=$?; wait; exit $moose_result\' moose-command "$1" 3<&-; ' +
            'moose_result=$?; kill "$moose_watch" 2>/dev/null; wait "$moose_watch" 2>/dev/null; exit $moose_result',
          'moose-supervisor',
          args.command,
        ],
        cwd,
        { ...agentEnvironment(), TERM: 'dumb' },
        true,
      );
      let finish = () => {};
      const done = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const active: Active = { job, child, done, dirty: false };
      this.active.set(job.id, active);
      const output = (chunk: string) => {
        job.output += stripVTControlCharacters(chunk);
        if (job.output.length > outputLimit) {
          job.output = job.output.slice(-outputLimit);
          job.truncated = true;
        }
        active.dirty = true;
      };
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', output);
      child.stderr.on('data', output);
      child.stdin.on('error', () => {});
      child.once('error', () => {
        job.status = 'failed';
        output('\nUnable to start the command process.\n');
      });
      let drainTimer: ReturnType<typeof setTimeout> | undefined;
      child.once('exit', () => {
        drainTimer = setTimeout(() => {
          job.status = 'unknown';
          child.stdout.destroy();
          child.stderr.destroy();
        }, 2000);
        drainTimer.unref();
        // No daemon descendants may keep a completed command's directory lock alive.
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* Process group already exited. */
        }
      });
      child.once('close', (code, signal) => {
        clearTimeout(drainTimer);
        job.exitCode = code;
        job.signal = signal;
        job.status =
          active.stopping ||
          (job.status === 'unknown'
            ? 'unknown'
            : job.status === 'failed'
              ? 'failed'
              : code === 0
                ? 'completed'
                : 'failed');
        job.endedAt = Date.now();
        this.records.save('command', job);
        this.records.trimCommandOutput(job.projectId);
        this.active.delete(job.id);
        unlock();
        finish();
      });
      return job;
    } catch (error) {
      job.status = 'failed';
      job.endedAt = Date.now();
      this.records.save('command', job);
      unlock();
      throw error;
    }
  }
  async input({ id, text, eof }: BackgroundRequests['commandInput']) {
    const active = this.active.get(id);
    if (
      !active ||
      active.stopping ||
      active.child.stdin.destroyed ||
      active.child.stdin.writableEnded
    )
      throw new Error('Command input is closed');
    await new Promise<void>((resolve, reject) => {
      active.child.stdin.write(text, (error) =>
        error ? reject(new Error('Command input failed')) : resolve(),
      );
    });
    if (eof) active.child.stdin.end();
  }
  async stop(id: string, status: JobStatus = 'cancelled') {
    const active = this.active.get(id);
    if (!active) {
      if (!this.records.get('command', id)) throw new Error('Command not found');
      return;
    }
    active.stopping ||= status;
    await terminate(active.child);
    await active.done;
  }
  private flush() {
    for (const active of this.active.values())
      if (active.dirty) {
        this.records.save('command', active.job);
        active.dirty = false;
      }
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    await Promise.all([...this.active.keys()].map((id) => this.stop(id, 'interrupted')));
    this.flush();
  }
}
