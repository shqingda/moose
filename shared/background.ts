import type { CalendarRule } from './calendar';
import type { TerminalRequests, TerminalResponses } from './terminal';
export interface BackgroundScope {
  projectId: string;
  sessionId?: string;
}
export type JobStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'unknown';
export interface CommandJob extends BackgroundScope {
  id: string;
  cwd: string;
  command: string;
  owner: 'moose';
  status: JobStatus;
  output: string;
  truncated: boolean;
  createdAt: number;
  endedAt?: number;
  exitCode: number | null;
  signal: string | null;
}
export type ScheduledTask = { kind: 'command' | 'agent'; text: string };
export interface ScheduleDefinition {
  name: string;
  task: ScheduledTask;
  timezone: string;
  startAt: number;
  intervalMs: number | null;
  calendar?: CalendarRule | null;
}
export interface Schedule extends BackgroundScope, ScheduleDefinition {
  id: string;
  cwd: string;
  nextAt: number;
  enabled: boolean;
  version: number;
  createdAt: number;
  last?: {
    id: string;
    dueAt: number;
    status: JobStatus | 'queued';
    queueId?: string;
    runId?: string;
    error?: string;
  };
}
export const schedulePending = (schedule: Schedule) =>
  schedule.last?.status === 'queued' || schedule.last?.status === 'running';
export const scheduleFinished = (schedule: Schedule) =>
  !schedule.calendar &&
  schedule.intervalMs === null &&
  !!schedule.last &&
  schedule.last.dueAt >= schedule.startAt;
export interface BackgroundRequests extends TerminalRequests {
  commandList: BackgroundScope;
  commandRead: { id: string };
  commandStart: BackgroundScope & { requestId: string; command: string };
  commandInput: { id: string; text: string; eof?: boolean };
  commandStop: { id: string };
  scheduleList: BackgroundScope;
  scheduleCreate: BackgroundScope & ScheduleDefinition & { requestId: string };
  scheduleUpdate: ScheduleDefinition & { id: string; version: number };
  scheduleSet: { id: string; version: number; enabled: boolean };
}
export interface BackgroundResponses extends TerminalResponses {
  commandList: Omit<CommandJob, 'output'>[];
  commandRead: CommandJob;
  commandStart: CommandJob;
  commandInput: null;
  commandStop: null;
  scheduleList: Schedule[];
  scheduleCreate: Schedule;
  scheduleUpdate: Schedule;
  scheduleSet: Schedule;
}
