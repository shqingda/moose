import type { providerIds } from './providers';
// 跨进程公共契约：请求、响应、事件和数据实体；此文件只描述类型，不负责运行时校验。
export interface PromptContext {
  inline?: boolean;
  mode: 'build' | 'plan' | 'goal';
  references: string[];
  skills: string[];
  goalBudget?: number;
  /** @deprecated 仅兼容旧草稿；底座自行决定委派，Moose 不再使用此字段。 */
  subagents?: boolean;
}
export const emptyContext: PromptContext = {
  inline: true,
  mode: 'build',
  references: [],
  skills: [],
};
export interface ContextEntry {
  id: string;
  name: string;
  path: string;
  kind: 'file' | 'folder' | 'skill';
  scope: 'global' | 'project';
  description: string;
}
export type PermissionMode = 'ask' | 'auto' | 'full';
export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
}
export type Provider = (typeof providerIds)[number];
export type Status =
  | 'idle'
  | 'queued'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'interrupted';
export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
}
export interface Session {
  worktreeId?: string | null;
  nativeOrigin?: import('./native-sessions').NativeOrigin | null;
  id: string;
  projectId: string;
  provider: Provider;
  title: string;
  archived: boolean;
  nativeId: string | null;
  model: string;
  effort: string;
  mode: string;
  draft: string;
  draftContext?: PromptContext;
  draftAttachments?: Attachment[];
  historySeed?: string;
  status: Status;
  createdAt: number;
  updatedAt: number;
}
export interface Choice {
  id: string;
  label: string;
  kind?: string;
}
export interface Question {
  id: string;
  text: string;
  options: string[];
  secret?: boolean;
}
export interface Message {
  id: string;
  position: number;
  sessionId: string;
  runId: string;
  seq: number;
  kind:
    | 'plan'
    | 'user'
    | 'assistant'
    | 'reasoning'
    | 'tool'
    | 'approval'
    | 'question'
    | 'error'
    | 'notice';
  text: string;
  title: string;
  state: 'running' | 'done' | 'error' | 'pending' | 'resolved' | 'expired';
  context?: PromptContext;
  attachments?: Attachment[];
  nativeTurnId?: string;
  choices?: Choice[];
  questions?: Question[];
  delegation?: Delegation;
  sourceThreadId?: string;
  plan?: { version: number; queueId?: string };
  delivery?: { status: 'sending' | 'accepted' | 'rejected' | 'unknown'; error?: string };
  createdAt: number;
}
/** 原生代理的委派活动；工具调用完成不代表子任务完成。 */
export interface Delegation {
  operation: 'spawn' | 'message' | 'resume' | 'wait' | 'close' | 'interrupt' | 'list' | 'activity';
  agents: {
    id: string;
    status: 'pending' | 'running' | 'completed' | 'interrupted' | 'failed' | 'closed' | 'unknown';
    message: string;
  }[];
  model?: string;
}
export interface QueueItem {
  id: string;
  sessionId: string;
  text: string;
  context?: PromptContext;
  attachments?: Attachment[];
  createdAt: number;
}
export interface Settings {
  theme: 'system' | 'light' | 'dark';
  language: 'system' | 'en' | 'zh-CN';
  codexEnabled: boolean;
  grokEnabled: boolean;
  piEnabled: boolean;
  codexPath: string;
  grokPath: string;
  piPath: string;
  fontScale: number;
}
export interface ModelOption {
  id: string;
  name: string;
  efforts: Choice[];
}
export interface ProviderInfo {
  enabled?: boolean;
  provider: Provider;
  path: string;
  version: string;
  available: boolean;
  connected: boolean;
  images?: boolean;
  error?: string;
  models: ModelOption[];
  modes: Choice[];
}
export interface GitFile {
  path: string;
  oldPath?: string;
  status: string;
  area: 'staged' | 'unstaged' | 'untracked';
}
export interface GitStatus {
  isRepo: boolean;
  branch: string;
  files: GitFile[];
  error?: string;
}
export interface GitDiff {
  text: string;
  binary: boolean;
  truncated: boolean;
}
export interface Snapshot {
  projects: Project[];
  sessions: Session[];
  settings: Settings;
  locale: string;
  dark: boolean;
  reduceMotion: boolean;
  reduceTransparency: boolean;
  highContrast: boolean;
}
export interface TranscriptPage {
  messages: Message[];
  hasMore: boolean;
}
export interface Requests {
  worktreeList: { projectId: string };
  worktreeCreate: {
    projectId: string;
    provider: Provider;
    ref: string;
    branch: string;
    requestId: string;
  };
  worktreeStatus: { id: string };
  worktreeKeep: { id: string; kept: boolean };
  worktreeRemove: { id: string };
  worktreeMerge: { id: string; sourceCommit: string; targetCommit: string; targetBranch: string };
  worktreeResolve: { id: string; path: string };
  worktreeComplete: { id: string; indexFingerprint: string };
  worktreeAbort: { id: string };
  workspacePath: { projectId: string; sessionId?: string };

  nativeCapabilities: { provider: Provider };
  nativeList: { projectId: string; sessionId?: string; provider: Provider; cursor?: string };
  nativeRead: {
    projectId: string;
    sessionId?: string;
    provider: Provider;
    nativeId: string;
    cursor?: string;
  };
  nativeImport: { projectId: string; sessionId?: string; provider: Provider; nativeId: string };
  nativeFork: { sessionId: string; turnId: string; requestId: string };
  nativeCompact: { sessionId: string; requestId: string };
  childThreads: { sessionId: string };
  childRead: { sessionId: string; nativeId: string; cursor?: string };
  childControl: {
    sessionId: string;
    nativeId: string;
    action: 'send' | 'stop' | 'resume';
    text?: string;
    requestId: string;
  };

  usage: { provider: Provider; sessionId?: string };
  searchFiles: { projectId: string; sessionId?: string; query: string };
  listSkills: { projectId: string; sessionId?: string };
  copyText: { text: string };
  responseText: { sessionId: string; runId: string };
  snapshot: Record<string, never>;
  addProject: Record<string, never>;
  deleteProject: { projectId: string };
  deleteSession: { sessionId: string };
  editMessage: { sessionId: string; messageId: string; text: string };
  pickAttachments: Record<string, never>;
  uploadAttachment: { name: string; data: string };
  attachmentPreview: { id: string };
  createSession: { projectId: string; provider: Provider };
  updateSession: {
    id: string;
    title?: string;
    archived?: boolean;
    draft?: string;
    model?: string;
    effort?: string;
    mode?: PermissionMode;
    draftAttachments?: string[];
    draftContext?: PromptContext;
  };
  messages: { sessionId: string; before?: number };
  send: { sessionId: string; text: string; attachments?: string[]; context?: PromptContext };
  steer: Requests['send'] & { requestId: string };
  editPlan: { sessionId: string; messageId: string; version: number; text: string };
  approvePlan: { sessionId: string; messageId: string; version: number };
  stop: { sessionId: string };
  queue: { sessionId: string };
  resumeQueue: { sessionId: string };
  updateQueue: { id: string; text?: string; remove?: boolean };
  respond: {
    sessionId: string;
    messageId: string;
    choice?: string;
    answers?: Record<string, string>;
  };
  providers: { refresh?: boolean };
  settings: Partial<Settings>;
  gitStatus: { projectId: string; sessionId?: string };
  gitDiff: { projectId: string; sessionId?: string; path: string; area: GitFile['area'] };
  openProject: { projectId: string; sessionId?: string; target: 'finder' | 'editor' };
  openExternal: { url: string };
}
export interface Responses {
  worktreeList: import('./worktrees').Worktree[];
  worktreeCreate: Session;
  worktreeStatus: import('./worktrees').WorktreeStatus;
  worktreeKeep: import('./worktrees').Worktree;
  worktreeRemove: import('./worktrees').Worktree;
  worktreeMerge: import('./worktrees').WorktreeStatus;
  worktreeResolve: import('./worktrees').WorktreeStatus;
  worktreeComplete: import('./worktrees').WorktreeStatus;
  worktreeAbort: import('./worktrees').WorktreeStatus;
  workspacePath: string;

  nativeCapabilities: import('./native-sessions').NativeCapabilities;
  nativeList: import('./native-sessions').NativePage<import('./native-sessions').NativeThread>;
  nativeRead: {
    thread: import('./native-sessions').NativeThread;
    items: import('./native-sessions').NativePage<import('./native-sessions').NativeEntry>;
  };
  nativeImport: Session;
  nativeFork: Session;
  nativeCompact: null;
  childThreads: import('./native-sessions').ChildThread[];
  childRead: Responses['nativeRead'] & { controllable: boolean };
  childControl: null;

  usage: UsageInfo;
  responseText: string;
  deleteProject: null;
  deleteSession: null;
  editMessage: Session;
  pickAttachments: Attachment[];
  uploadAttachment: Attachment;
  attachmentPreview: string | null;
  searchFiles: ContextEntry[];
  listSkills: ContextEntry[];
  copyText: null;
  snapshot: Snapshot;
  addProject: Project | null;
  createSession: Session;
  updateSession: Session;
  messages: TranscriptPage;
  send: QueueItem;
  steer: Message;
  editPlan: Message;
  approvePlan: QueueItem;
  stop: null;
  queue: QueueItem[];
  resumeQueue: null;
  updateQueue: null;
  respond: null;
  providers: ProviderInfo[];
  settings: Settings;
  gitStatus: GitStatus;
  gitDiff: GitDiff;
  openProject: null;
  openExternal: null;
}
export type Method = keyof Requests;
export type AppEvent =
  | { type: 'transcript-reset'; sessionId: string }
  | { type: 'changed' }
  | { type: 'message'; message: Message }
  | {
      type: 'command';
      command: 'new' | 'search' | 'settings' | 'sidebar' | 'open' | 'review' | 'usage';
    }
  | { type: 'appearance' }
  | { type: 'runtime-error'; error: string };
export interface MooseAPI {
  request<M extends Method>(method: M, params: Requests[M]): Promise<Responses[M]>;
  subscribe(listener: (event: AppEvent) => void): () => void;
}
export const defaultSettings: Settings = {
  theme: 'system',
  language: 'system',
  codexEnabled: true,
  grokEnabled: true,
  piEnabled: true,
  codexPath: '',
  grokPath: '',
  piPath: '',
  fontScale: 1,
};

export interface ContextUsage {
  used: number;
  capacity: number | null;
}
export interface UsageInfo {
  context: ContextUsage | null;
  limits: {
    name: string;
    plan: string | null;
    windows: { usedPercent: number; minutes: number | null; resetsAt: number | null }[];
  }[];
  error?: string;
}
