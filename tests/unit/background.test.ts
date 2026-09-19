import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, realpathSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../../electron/db/store';
import { BackgroundStore } from '../../electron/background-store';
import { CommandJobs } from '../../electron/command-jobs';
import { Schedules } from '../../electron/schedules';
import { MooseService } from '../../electron/service';
import type { Schedule, CommandJob } from '../../shared/background';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
function fixture() {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'moose-background-'))),
    store = new Store(join(cwd, 'data.sqlite')),
    records = new BackgroundStore(store),
    project = store.addProject(cwd),
    session = store.createSession(project.id, 'codex'),
    scope = { projectId: project.id, sessionId: session.id };
  const locks = new Set<string>();
  const commands = new CommandJobs(records, (path) => {
    if (locks.has(path)) throw new Error('busy');
    locks.add(path);
    return () => locks.delete(path);
  });
  let now = 100000,
    busy = false;
  const hooks = {
    ready: () => !busy,
    enqueue: vi.fn((s: Schedule) => store.enqueue(s.sessionId!, s.task.text).id),
    wake: vi.fn(),
  };
  const schedules = new Schedules(records, commands, hooks, () => now);
  cleanup.push(async () => {
    schedules.close();
    await commands.close();
    store.close();
    rmSync(cwd, { force: true, recursive: true });
  });
  const create = (patch: Partial<Parameters<Schedules['create']>[0]> = {}) =>
    schedules.create({
      ...scope,
      requestId: randomUUID(),
      name: 'test',
      task: { kind: 'command', text: 'printf scheduled' },
      timezone: 'Asia/Shanghai',
      startAt: now + 1000,
      intervalMs: 60000,
      ...patch,
    });
  return {
    cwd,
    store,
    records,
    scope,
    commands,
    schedules,
    hooks,
    locks,
    create,
    clock: (value: number) => {
      now = value;
    },
    busy: (value: boolean) => {
      busy = value;
    },
  };
}
it('runs a real shell in its exact directory, accepts input, persists exit status and deduplicates start', async () => {
  const f = fixture(),
    args = {
      ...f.scope,
      requestId: randomUUID(),
      command: 'read value; printf "got:%s" "$value"; pwd',
    };
  const job = f.commands.start(args);
  expect(f.commands.start(args).id).toBe(job.id);
  await f.commands.input({ id: job.id, text: 'hello\n' });
  await vi.waitFor(() => expect(f.commands.read(job.id).status).toBe('completed'));
  expect(f.commands.read(job.id).output).toContain('got:hello' + f.cwd);
  expect(f.commands.read(job.id).exitCode).toBe(0);
  expect(f.locks.size).toBe(0);
  expect(f.commands.start(args).status).toBe('completed');
  expect(() => f.commands.start({ ...args, command: 'echo other' })).toThrow('already used');
});
it('bounds captured output, handles failed exits, and closes stdin', async () => {
  const f = fixture(),
    job = f.commands.start({
      ...f.scope,
      requestId: randomUUID(),
      command: "cat; head -c 200000 /dev/zero | tr '\\0' x; exit 7",
    });
  await f.commands.input({ id: job.id, text: 'input\n', eof: true });
  await vi.waitFor(() => expect(f.commands.read(job.id).status).toBe('failed'));
  expect(f.commands.read(job.id).exitCode).toBe(7);
  expect(f.commands.read(job.id).truncated).toBe(true);
  expect(f.commands.read(job.id).output.length).toBeLessThanOrEqual(128 * 1024);
  expect(f.commands.list(f.scope.projectId)[0]).not.toHaveProperty('output');
});
it('stops the whole command group, rejects concurrent directory writers and preserves interrupted shutdown', async () => {
  const f = fixture(),
    job = f.commands.start({ ...f.scope, requestId: randomUUID(), command: 'sleep 30 & wait' });
  expect(() =>
    f.commands.start({ ...f.scope, requestId: randomUUID(), command: 'echo wrong' }),
  ).toThrow('busy');
  await f.commands.stop(job.id);
  expect(f.commands.read(job.id).status).toBe('cancelled');
  expect(f.locks.size).toBe(0);
  const next = f.commands.start({ ...f.scope, requestId: randomUUID(), command: 'sleep 30' });
  await f.commands.close();
  expect(f.commands.read(next.id).status).toBe('interrupted');
});
it('allows separate project directories concurrently', async () => {
  const f = fixture();
  mkdirSync(join(f.cwd, 'other'));
  const project = f.store.addProject(join(f.cwd, 'other'));
  const a = f.commands.start({ ...f.scope, requestId: randomUUID(), command: 'sleep 30' }),
    b = f.commands.start({ projectId: project.id, requestId: randomUUID(), command: 'sleep 30' });
  expect(f.locks.size).toBe(2);
  await Promise.all([f.commands.stop(a.id), f.commands.stop(b.id)]);
});
it('coalesces missed intervals into one run and never overlaps the previous command', async () => {
  const f = fixture(),
    schedule = f.create({ task: { kind: 'command', text: 'read value; echo "$value"' } });
  f.clock(701000);
  f.schedules.tick();
  const first = f.schedules.list(f.scope.projectId)[0];
  expect(first.nextAt).toBe(761000);
  expect(first.last?.dueAt).toBe(101000);
  f.clock(1000000);
  f.schedules.tick();
  expect(f.schedules.list(f.scope.projectId)[0].last?.id).toBe(first.last?.id);
  await f.commands.input({ id: first.last!.id, text: 'done\n' });
  await vi.waitFor(() => expect(f.commands.read(first.last!.id).status).toBe('completed'));
  f.schedules.tick();
  const second = f.schedules.list(f.scope.projectId)[0];
  expect(second.last?.id).not.toBe(first.last?.id);
  expect(second.id).toBe(schedule.id);
});
it('persists one-time claims and does not trigger them twice after success', async () => {
  const f = fixture();
  f.create({ intervalMs: null });
  f.clock(102000);
  f.schedules.tick();
  const schedule = f.schedules.list(f.scope.projectId)[0];
  expect(schedule.enabled).toBe(false);
  await vi.waitFor(() => expect(f.commands.read(schedule.last!.id).status).toBe('completed'));
  f.schedules.tick();
  f.clock(900000);
  f.schedules.tick();
  expect(f.commands.list(f.scope.projectId)).toHaveLength(1);
  expect(f.schedules.list(f.scope.projectId)[0].last?.status).toBe('completed');
});
it('atomically enqueues one agent occurrence and tracks start, completion and failures', () => {
  const f = fixture();
  f.create({ task: { kind: 'agent', text: 'inspect files' } });
  f.clock(102000);
  f.schedules.tick();
  const s = f.schedules.list(f.scope.projectId)[0];
  expect(s.last?.status).toBe('queued');
  expect(f.store.queued()).toHaveLength(1);
  f.clock(500000);
  f.schedules.tick();
  expect(f.store.queued()).toHaveLength(1);
  f.schedules.started(s.last!.queueId!, 'run');
  f.schedules.finished('run', 'failed');
  const failed = f.schedules.list(f.scope.projectId)[0];
  expect(failed.enabled).toBe(false);
  expect(failed.last?.status).toBe('failed');
});
it('waits for directory locks, pauses dispatch failures, and validates stale schedule edits', () => {
  const f = fixture(),
    s = f.create();
  f.busy(true);
  f.clock(102000);
  f.schedules.tick();
  expect(f.commands.list(f.scope.projectId)).toHaveLength(0);
  f.schedules.set({ id: s.id, version: s.version, enabled: false });
  expect(() => f.schedules.set({ id: s.id, version: s.version, enabled: true })).toThrow('changed');
  const agent = f.create({ task: { kind: 'agent', text: 'fail' } });
  f.hooks.enqueue.mockImplementationOnce(() => {
    throw new Error('failure');
  });
  f.busy(false);
  f.clock(104000);
  f.schedules.tick();
  expect(f.store.queued()).toHaveLength(0);
  expect(f.records.get('schedule', agent.id)?.enabled).toBe(false);
});
it('recovers running records as unknown without replaying side effects', async () => {
  const f = fixture(),
    job: CommandJob = {
      ...f.scope,
      id: randomUUID(),
      cwd: f.cwd,
      command: 'echo never',
      owner: 'moose',
      status: 'running',
      output: 'partial',
      truncated: false,
      createdAt: 1,
      exitCode: null,
      signal: null,
    };
  f.records.save('command', job);
  const s = f.create();
  s.last = { id: job.id, dueAt: s.nextAt, status: 'running' };
  f.records.save('schedule', s);
  f.schedules.close();
  await f.commands.close();
  const commands = new CommandJobs(f.records, () => () => {}),
    schedules = new Schedules(f.records, commands, f.hooks, () => 900000);
  schedules.tick();
  expect(f.records.get('command', job.id)?.status).toBe('unknown');
  expect(f.records.get('schedule', s.id)?.enabled).toBe(false);
  expect(f.hooks.enqueue).not.toHaveBeenCalled();
  schedules.close();
  await commands.close();
});
it('deleting a conversation removes its schedules and retained command output', () => {
  const f = fixture();
  f.create();
  f.store.updateSession(f.scope.sessionId, { archived: true });
  f.store.deleteSession(f.scope.sessionId);
  expect(f.schedules.list(f.scope.projectId)).toEqual([]);
});
it('edits paused definitions without changing ownership or replaying the original create request', () => {
  const f = fixture(),
    original = f.create(),
    createArgs = {
      ...f.scope,
      requestId: original.id,
      name: original.name,
      task: original.task,
      timezone: original.timezone,
      startAt: original.startAt,
      intervalMs: original.intervalMs,
    };
  // Previously saved schedules do not yet have a creation fingerprint.
  delete original.creationFingerprint;
  f.records.save('schedule', original);
  const change = {
    id: original.id,
    version: original.version,
    name: 'edited',
    task: { kind: 'agent' as const, text: 'review only' },
    timezone: 'UTC',
    startAt: 200000,
    intervalMs: 120000,
  };
  expect(() => f.schedules.update(change)).toThrow('Pause');
  const paused = f.schedules.set({ id: original.id, version: original.version, enabled: false });
  expect(() => f.schedules.update(change)).toThrow('changed');
  const edited = f.schedules.update({ ...change, version: paused.version });
  expect(edited).toMatchObject({
    ...change,
    version: paused.version + 1,
    enabled: false,
    cwd: original.cwd,
    projectId: original.projectId,
    sessionId: original.sessionId,
    nextAt: 200000,
  });
  expect(f.schedules.create(createArgs)).toEqual(edited);
  expect(() => f.schedules.create({ ...createArgs, name: 'different' })).toThrow('already used');
  expect(() => f.schedules.update({ ...change, version: paused.version })).toThrow('changed');
  f.clock(201000);
  f.schedules.tick();
  expect(f.hooks.enqueue).not.toHaveBeenCalled();
  const resumed = f.schedules.set({ id: edited.id, version: edited.version, enabled: true });
  f.clock(resumed.nextAt);
  f.schedules.tick();
  expect(f.store.queued().map((item) => item.text)).toEqual(['review only']);
});
it('rejects editing queued and running occurrences until they settle', () => {
  const f = fixture(),
    s = f.create({ task: { kind: 'agent', text: 'original task' } });
  f.clock(s.nextAt);
  f.schedules.tick();
  let current = f.records.get('schedule', s.id)!;
  current = f.schedules.set({ id: s.id, version: current.version, enabled: false });
  const change = {
    id: s.id,
    version: current.version,
    name: 'new',
    task: s.task,
    startAt: 300000,
    intervalMs: s.intervalMs,
    timezone: s.timezone,
  };
  expect(() => f.schedules.update(change)).toThrow('current occurrence');
  const queued = f.store.queued()[0];
  f.store.begin(queued, 'scheduled-run');
  f.schedules.started(queued.id, 'scheduled-run');
  current = f.records.get('schedule', s.id)!;
  expect(() => f.schedules.update({ ...change, version: current.version })).toThrow(
    'current occurrence',
  );
  f.schedules.finished('scheduled-run', 'completed');
  expect(() => f.schedules.update({ ...change, version: current.version })).toThrow('changed');
  const finished = f.records.get('schedule', s.id)!;
  expect(f.schedules.update({ ...change, version: finished.version }).last).toEqual(finished.last);
});
it('can change a recurring task to one final occurrence without rearming a consumed one-time task', () => {
  const f = fixture(),
    s = f.create({ task: { kind: 'agent', text: 'original task' } });
  f.clock(s.nextAt);
  f.schedules.tick();
  const queued = f.store.queued()[0];
  f.store.begin(queued, 'first');
  f.schedules.started(queued.id, 'first');
  f.schedules.finished('first', 'completed');
  let current = f.records.get('schedule', s.id)!;
  current = f.schedules.set({ id: s.id, version: current.version, enabled: false });
  const change = {
    id: s.id,
    version: current.version,
    name: 'final',
    task: s.task,
    startAt: 300000,
    intervalMs: null,
    timezone: s.timezone,
  };
  current = f.schedules.update(change);
  f.schedules.set({ id: s.id, version: current.version, enabled: true });
  f.clock(300000);
  f.schedules.tick();
  const last = f.store.queued()[0];
  f.store.begin(last, 'last');
  f.schedules.started(last.id, 'last');
  f.schedules.finished('last', 'completed');
  current = f.records.get('schedule', s.id)!;
  expect(current.enabled).toBe(false);
  expect(() =>
    f.schedules.update({ ...change, version: current.version, startAt: 400000 }),
  ).toThrow('new one-time');
  expect(() => f.schedules.set({ id: s.id, version: current.version, enabled: true })).toThrow(
    'new one-time',
  );
  f.clock(900000);
  f.schedules.tick();
  expect(f.hooks.enqueue).toHaveBeenCalledTimes(2);
});
it('keeps edits within their original directory and conversation and rejects elapsed start times', () => {
  const f = fixture(),
    s = f.create({ sessionId: undefined });
  const paused = f.schedules.set({ id: s.id, version: s.version, enabled: false });
  const change = {
    id: s.id,
    version: paused.version,
    name: s.name,
    task: s.task,
    startAt: 200000,
    intervalMs: s.intervalMs,
    timezone: s.timezone,
  };
  expect(() => f.schedules.update({ ...change, startAt: 100000 })).toThrow('future');
  expect(() => f.schedules.update({ ...change, task: { kind: 'agent', text: 'test' } })).toThrow(
    'conversation',
  );
  vi.spyOn(f.store, 'directory').mockReturnValueOnce('/another-directory');
  expect(() => f.schedules.update(change)).toThrow('directory changed');
  expect(f.records.get('schedule', s.id)).toEqual(paused);
});
it('recovers a finished command receipt before marking interrupted occurrences unknown', async () => {
  const f = fixture(),
    s = f.create({ intervalMs: null });
  f.clock(s.nextAt);
  f.schedules.tick();
  f.schedules.close();
  const claimed = f.records.get('schedule', s.id)!;
  await vi.waitFor(() => expect(f.commands.read(claimed.last!.id).status).toBe('completed'));
  expect(f.records.get('schedule', s.id)?.last?.status).toBe('running');
  const recovered = new Schedules(f.records, f.commands, f.hooks, () => 900000);
  try {
    expect(f.records.get('schedule', s.id)).toMatchObject({
      enabled: false,
      last: { status: 'completed' },
    });
    recovered.tick();
    expect(f.commands.list(f.scope.projectId)).toHaveLength(1);
  } finally {
    recovered.close();
  }
});
it('retains persisted queued occurrences on restart, blocks edits, and never enqueues duplicates', () => {
  const f = fixture(),
    s = f.create({ task: { kind: 'agent', text: 'queued before restart' } });
  f.clock(s.nextAt);
  f.schedules.tick();
  f.schedules.close();
  const recovered = new Schedules(f.records, f.commands, f.hooks, () => 900000);
  try {
    let current = f.records.get('schedule', s.id)!;
    expect(current).toMatchObject({ enabled: false, last: { status: 'queued' } });
    expect(() =>
      recovered.update({
        id: s.id,
        version: current.version,
        name: s.name,
        task: s.task,
        timezone: s.timezone,
        startAt: 950000,
        intervalMs: s.intervalMs,
      }),
    ).toThrow('current occurrence');
    current = recovered.set({ id: s.id, version: current.version, enabled: true });
    recovered.tick();
    expect(f.store.queued()).toHaveLength(1);
    expect(f.hooks.enqueue).toHaveBeenCalledTimes(1);
    const queued = f.store.queued()[0];
    f.store.updateQueue(queued.id, undefined, true);
    recovered.removed(queued.id);
    expect(f.records.get('schedule', s.id)).toMatchObject({
      enabled: false,
      last: { status: 'cancelled' },
    });
  } finally {
    recovered.close();
  }
});
it('service directory locks block agent starts and Git writes until command exits', async () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'moose-background-service-'))),
    store = new Store(join(cwd, 'data.sqlite')),
    service = new MooseService(store, () => {});
  cleanup.push(async () => {
    await service.close();
    rmSync(cwd, { recursive: true, force: true });
  });
  const project = store.addProject(cwd),
    session = store.createSession(project.id, 'codex'),
    scope = { projectId: project.id, sessionId: session.id };
  const job = (await service.handle('commandStart', {
    ...scope,
    requestId: randomUUID(),
    command: 'read value; printf "%s" "$value" > result.txt',
  })) as CommandJob;
  await expect(
    service.handle('gitStage', { ...scope, path: 'result.txt', staged: true }),
  ).rejects.toThrow('Wait');
  await expect(service.handle('send', { sessionId: session.id, text: 'blocked' })).rejects.toThrow(
    'wait',
  );
  await service.handle('commandInput', { id: job.id, text: 'written\n' });
  await vi.waitFor(async () =>
    expect(((await service.handle('commandRead', { id: job.id })) as CommandJob).status).toBe(
      'completed',
    ),
  );
  expect(readFileSync(join(cwd, 'result.txt'), 'utf8')).toBe('written');
});
it('kills owned commands when the runtime process disappears abruptly', async () => {
  const f = fixture();
  const { spawn } = await import('node:child_process');
  const script = `import {Store} from './electron/db/store.ts';import {BackgroundStore} from './electron/background-store.ts';import {CommandJobs} from './electron/command-jobs.ts';const store=new Store(process.argv[1]+'/data.sqlite');const jobs=new CommandJobs(new BackgroundStore(store),()=>()=>{});jobs.start({projectId:process.argv[2],sessionId:process.argv[3],requestId:'crash-test',command:'printf "%s" "$$" > command-pid; read line'});setInterval(()=>{},1000);`;
  const controller = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type',
      'module',
      '-e',
      script,
      f.cwd,
      f.scope.projectId,
      f.scope.sessionId,
    ],
    { stdio: 'ignore' },
  );
  try {
    await vi.waitFor(
      () => expect(Number(readFileSync(join(f.cwd, 'command-pid'), 'utf8'))).toBeGreaterThan(0),
      { timeout: 5000 },
    );
    const pid = Number(readFileSync(join(f.cwd, 'command-pid'), 'utf8'));
    controller.kill('SIGKILL');
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 4000 });
  } finally {
    controller.kill('SIGKILL');
  }
});
