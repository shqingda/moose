import { nextCalendar } from '../shared/calendar';
import { createHash, randomUUID } from 'node:crypto';
import { BackgroundStore, type StoredSchedule } from './background-store';
import { CommandJobs } from './command-jobs';
import {
  schedulePending,
  scheduleFinished,
  type BackgroundRequests,
  type JobStatus,
  type Schedule,
} from '../shared/background';
/** Keep the original create intent stable when the editable definition changes. */
function creationFingerprint(value: Omit<BackgroundRequests['scheduleCreate'], 'requestId'>) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        value.projectId,
        value.sessionId ?? null,
        value.name,
        value.task.kind,
        value.task.text,
        value.timezone,
        value.startAt,
        value.intervalMs,
        ...(value.calendar
          ? [[...value.calendar.weekdays].sort(), value.calendar.hour, value.calendar.minute]
          : []),
      ]),
    )
    .digest('hex');
}
export interface ScheduleHooks {
  ready(schedule: Schedule): boolean;
  enqueue(schedule: Schedule): string;
  wake(): void;
}
/** Calendar rules and elapsed intervals; claim before side effects, never replay unknown runs. */
export class Schedules {
  private timer: ReturnType<typeof setInterval>;
  private closed = false;
  constructor(
    private records: BackgroundStore,
    private commands: CommandJobs,
    private hooks: ScheduleHooks,
    private now = Date.now,
  ) {
    this.reconcileCommands();
    const queued = new Set(records.store.queued().map((item) => item.id));
    for (const schedule of records.list('schedule'))
      if (schedule.last && schedulePending(schedule)) {
        if (schedule.last.queueId && queued.has(schedule.last.queueId)) {
          schedule.last.status = 'queued';
          this.pause(
            schedule,
            'This occurrence is still queued. Resume or remove it in its conversation.',
          );
        } else {
          schedule.last.status = 'unknown';
          this.pause(
            schedule,
            'Moose restarted during this occurrence. Check its history before resuming.',
          );
        }
      }
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref();
  }
  list(projectId: string) {
    return this.records
      .list('schedule')
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  create(args: BackgroundRequests['scheduleCreate']) {
    const prior = this.records.get('schedule', args.requestId);
    if (prior) {
      if ((prior.creationFingerprint ?? creationFingerprint(prior)) !== creationFingerprint(args))
        throw new Error('Request ID already used');
      return prior;
    }
    if (args.calendar && args.intervalMs !== null)
      throw new Error('Choose calendar or interval scheduling');
    const cwd = this.records.store.directory(args.projectId, args.sessionId);
    if (args.task.kind === 'agent' && !args.sessionId)
      throw new Error('Choose a conversation for the scheduled agent task');
    if (args.startAt <= this.now()) throw new Error('Choose a future start time');
    const schedule: StoredSchedule = {
      id: args.requestId,
      name: args.name,
      projectId: args.projectId,
      sessionId: args.sessionId,
      cwd,
      task: args.task,
      timezone: args.timezone,
      nextAt: args.calendar
        ? nextCalendar(args.calendar, args.timezone, args.startAt - 1)
        : args.startAt,
      calendar: args.calendar ?? null,
      intervalMs: args.intervalMs,
      enabled: true,
      version: 1,
      createdAt: this.now(),
      startAt: args.startAt,
      creationFingerprint: creationFingerprint(args),
    };
    this.records.save('schedule', schedule);
    return schedule;
  }
  private editableVersion(id: string, version: number) {
    const schedule = this.records.get('schedule', id);
    if (!schedule) throw new Error('Schedule not found');
    if (schedule.version !== version) throw new Error('Schedule changed. Refresh before editing.');
    return schedule;
  }
  update({ id, version, ...definition }: BackgroundRequests['scheduleUpdate']) {
    const schedule = this.editableVersion(id, version);
    if (schedule.enabled) throw new Error('Pause the schedule before editing');
    if (schedulePending(schedule)) throw new Error('Wait for the current occurrence to finish');
    if (scheduleFinished(schedule)) throw new Error('Create a new one-time schedule');
    if (this.records.store.directory(schedule.projectId, schedule.sessionId) !== schedule.cwd)
      throw new Error('Working directory changed');
    if (definition.task.kind === 'agent' && !schedule.sessionId)
      throw new Error('Choose a conversation for the scheduled agent task');
    if (definition.startAt <= this.now()) throw new Error('Choose a future start time');
    if (definition.calendar && definition.intervalMs !== null)
      throw new Error('Choose calendar or interval scheduling');
    const updated = {
      ...schedule,
      creationFingerprint: schedule.creationFingerprint ?? creationFingerprint(schedule),
      ...definition,
      calendar: definition.calendar ?? null,
      nextAt: definition.calendar
        ? nextCalendar(definition.calendar, definition.timezone, definition.startAt - 1)
        : definition.startAt,
      version: schedule.version + 1,
    };
    this.records.save('schedule', updated);
    return updated;
  }
  set({ id, version, enabled }: BackgroundRequests['scheduleSet']) {
    const schedule = this.editableVersion(id, version);
    if (enabled) {
      this.records.store.directory(schedule.projectId, schedule.sessionId);
      if (scheduleFinished(schedule)) throw new Error('Create a new one-time schedule');
      schedule.nextAt = schedule.calendar
        ? nextCalendar(
            schedule.calendar,
            schedule.timezone,
            Math.max(this.now(), schedule.startAt - 1),
          )
        : Math.max(this.now() + 1000, schedule.nextAt);
    }
    schedule.enabled = enabled;
    schedule.version++;
    this.records.save('schedule', schedule);
    return schedule;
  }
  private pause(schedule: Schedule, error: string) {
    schedule.enabled = false;
    schedule.version++;
    if (schedule.last) schedule.last.error = error;
    this.records.save('schedule', schedule);
  }
  reconcileCommands() {
    for (const schedule of this.records.list('schedule')) {
      if (schedule.last?.status === 'running' && schedule.task.kind === 'command') {
        const job = this.records.get('command', schedule.last.id);
        if (job && job.status !== 'running') {
          schedule.last.status = job.status;
          if (job.status !== 'completed') {
            this.pause(schedule, 'Command did not complete. Review its output before resuming.');
            continue;
          }
          schedule.version++;
          delete schedule.last.error;
          this.records.save('schedule', schedule);
        }
      }
    }
  }
  tick() {
    if (this.closed) return;
    this.reconcileCommands();
    for (const schedule of this.records.list('schedule')) {
      if (!schedule.enabled || schedule.nextAt > this.now() || schedulePending(schedule)) continue;
      try {
        if (this.records.store.directory(schedule.projectId, schedule.sessionId) !== schedule.cwd)
          throw new Error('Working directory changed');
        if (!this.hooks.ready(schedule)) continue;
        const dueAt = schedule.nextAt,
          id = randomUUID();
        this.records.store.sqlite.transaction(() => {
          schedule.last = {
            id,
            dueAt,
            status: schedule.task.kind === 'agent' ? 'queued' : 'running',
          };
          if (schedule.calendar)
            schedule.nextAt = nextCalendar(schedule.calendar, schedule.timezone, this.now());
          else if (schedule.intervalMs)
            schedule.nextAt +=
              (Math.floor((this.now() - schedule.nextAt) / schedule.intervalMs) + 1) *
              schedule.intervalMs;
          else schedule.enabled = false;
          schedule.version++;
          if (schedule.task.kind === 'agent') schedule.last.queueId = this.hooks.enqueue(schedule);
          this.records.save('schedule', schedule);
        })();
        if (schedule.task.kind === 'command')
          this.commands.start({
            projectId: schedule.projectId,
            sessionId: schedule.sessionId,
            requestId: id,
            command: schedule.task.text,
          });
        this.hooks.wake();
      } catch {
        schedule.last = {
          ...(schedule.last || { id: randomUUID(), dueAt: schedule.nextAt }),
          status: 'failed',
        };
        this.pause(
          schedule,
          'Scheduled dispatch failed. Check the conversation and working directory before resuming.',
        );
      }
    }
  }
  started(queueId: string, runId: string) {
    for (const schedule of this.records.list('schedule'))
      if (schedule.last?.queueId === queueId) {
        schedule.last.status = 'running';
        schedule.last.runId = runId;
        schedule.version++;
        this.records.save('schedule', schedule);
      }
  }
  finished(runId: string, status: JobStatus) {
    for (const schedule of this.records.list('schedule'))
      if (schedule.last?.runId === runId) {
        schedule.last.status = status;
        if (status !== 'completed')
          this.pause(
            schedule,
            'Agent task did not complete. Review the conversation before resuming.',
          );
        else {
          schedule.version++;
          delete schedule.last.error;
          this.records.save('schedule', schedule);
        }
      }
  }
  failedToStart(queueId: string) {
    for (const schedule of this.records.list('schedule'))
      if (schedule.last?.queueId === queueId) {
        schedule.last.status = 'failed';
        this.pause(schedule, 'Agent could not start. Check the conversation before resuming.');
      }
  }
  removed(queueId: string) {
    for (const schedule of this.records.list('schedule'))
      if (schedule.last?.queueId === queueId && schedule.last.status === 'queued') {
        schedule.last.status = 'cancelled';
        this.pause(schedule, 'Queued occurrence was removed.');
      }
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
  }
}
