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
export interface TerminalControl {
  owned: boolean;
  available: boolean;
  lease: string | null;
}
export interface TerminalRequests {
  terminalControl: {
    id: string;
    action: 'acquire' | 'takeover' | 'renew' | 'release';
    lease?: string;
  };

  terminalList: BackgroundScope;
  terminalStart: BackgroundScope & { requestId: string; cols: number; rows: number };
  terminalRead: { id: string; offset: number };
  terminalInput: { id: string; text: string; lease?: string };
  terminalResize: { id: string; cols: number; rows: number; lease?: string };
  terminalStop: { id: string };
}
export interface TerminalResponses {
  terminalControl: TerminalControl;
  terminalList: TerminalSession[];
  terminalStart: TerminalSession;
  terminalRead: TerminalOutput;
  terminalInput: null;
  terminalResize: null;
  terminalStop: null;
}
