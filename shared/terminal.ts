import type { BackgroundScope, JobStatus } from './background';
export interface TerminalSession extends BackgroundScope {
  id: string;
  cwd: string;
  title?: string;
  status: JobStatus;
  createdAt: number;
  exitCode: number | null;
  cols: number;
  rows: number;
}
export interface TerminalOutput {
  session: TerminalSession;
  data: string;
  offset: number;
  reset: boolean;
}
export interface TerminalRequests {
  terminalList: BackgroundScope;
  terminalStart: BackgroundScope & { requestId: string; cols: number; rows: number };
  terminalRead: { id: string; offset: number };
  terminalInput: { id: string; text: string };
  terminalResize: { id: string; cols: number; rows: number };
  terminalStop: { id: string };
}
export interface TerminalResponses {
  terminalList: TerminalSession[];
  terminalStart: TerminalSession;
  terminalRead: TerminalOutput;
  terminalInput: null;
  terminalResize: null;
  terminalStop: null;
}
