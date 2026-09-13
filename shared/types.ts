export interface PromptContext { mode: 'build' | 'plan' | 'goal'; references: string[]; skills: string[]; goalBudget?: number }
export const emptyContext: PromptContext = { mode: 'build', references: [], skills: [] };
export interface ContextEntry { id: string; name: string; path: string; kind: 'file' | 'folder' | 'skill'; scope: 'global' | 'project'; description: string }
export type PermissionMode = 'ask' | 'auto' | 'full';
export interface Attachment { id: string; name: string; mime: string; size: number }
export type Provider = 'codex' | 'grok';
export type Status = 'idle' | 'queued' | 'running' | 'waiting' | 'completed' | 'cancelled' | 'failed' | 'interrupted';
export interface Project { id: string; name: string; path: string; createdAt: number }
export interface Session {
  id: string; projectId: string; provider: Provider; title: string; archived: boolean;
  nativeId: string | null; model: string; effort: string; mode: string; draft: string;
  draftContext?: PromptContext; draftAttachments?: Attachment[]; historySeed?: string;
  status: Status; createdAt: number; updatedAt: number;
}
export interface Choice { id: string; label: string; kind?: string }
export interface Question { id: string; text: string; options: string[]; secret?: boolean }
export interface Message {
  id: string; position: number; sessionId: string; runId: string; seq: number;
  kind: 'user' | 'assistant' | 'reasoning' | 'tool' | 'approval' | 'question' | 'error' | 'notice';
  text: string; title: string; state: 'running' | 'done' | 'error' | 'pending' | 'resolved' | 'expired';
  context?: PromptContext; attachments?: Attachment[]; nativeTurnId?: string; choices?: Choice[]; questions?: Question[]; createdAt: number;
}
export interface QueueItem { id: string; sessionId: string; text: string; context?: PromptContext; attachments?: Attachment[]; createdAt: number }
export interface Settings {
  theme: 'system' | 'light' | 'dark'; language: 'system' | 'en' | 'zh-CN';
  codexPath: string; grokPath: string; fontScale: number;
}
export interface ModelOption { id: string; name: string; efforts: Choice[] }
export interface ProviderInfo {
  provider: Provider; path: string; version: string; available: boolean; connected: boolean;
  images?: boolean; error?: string; models: ModelOption[]; modes: Choice[];
}
export interface GitFile { path: string; oldPath?: string; status: string; area: 'staged' | 'unstaged' | 'untracked' }
export interface GitStatus { isRepo: boolean; branch: string; files: GitFile[]; error?: string }
export interface GitDiff { text: string; binary: boolean; truncated: boolean }
export interface Snapshot { projects: Project[]; sessions: Session[]; settings: Settings; locale: string; dark: boolean; reduceMotion: boolean; reduceTransparency: boolean; highContrast: boolean }
export interface TranscriptPage { messages: Message[]; hasMore: boolean }
export interface Requests {
  searchFiles: { projectId: string; query: string };
  listSkills: { projectId: string };
  copyText: { text: string };
  snapshot: Record<string, never>;
  addProject: Record<string, never>;
  deleteProject: { projectId: string };
  archiveProject: { projectId: string };
  rewind: { sessionId: string; messageId: string; edit?: boolean };
  pickAttachments: Record<string, never>;
  uploadAttachment: { name: string; data: string };
  attachmentPreview: { id: string };
  createSession: { projectId: string; provider: Provider };
  updateSession: { id: string; title?: string; archived?: boolean; draft?: string; model?: string; effort?: string; mode?: PermissionMode; draftAttachments?: string[]; draftContext?: PromptContext };
  messages: { sessionId: string; before?: number };
  send: { sessionId: string; text: string; attachments?: string[]; context?: PromptContext };
  stop: { sessionId: string };
  queue: { sessionId: string };
  resumeQueue: { sessionId: string };
  updateQueue: { id: string; text?: string; remove?: boolean };
  respond: { sessionId: string; messageId: string; choice?: string; answers?: Record<string, string> };
  providers: { refresh?: boolean };
  settings: Partial<Settings>;
  gitStatus: { projectId: string };
  gitDiff: { projectId: string; path: string; area: GitFile['area'] };
  openProject: { projectId: string; target: 'finder' | 'editor' };
  openExternal: { url: string };
}
export interface Responses {
  deleteProject: null; archiveProject: null; rewind: Session; pickAttachments: Attachment[]; uploadAttachment: Attachment; attachmentPreview: string | null;
  searchFiles: ContextEntry[]; listSkills: ContextEntry[]; copyText: null; snapshot: Snapshot; addProject: Project | null; createSession: Session; updateSession: Session;
  messages: TranscriptPage; send: QueueItem; stop: null; queue: QueueItem[]; resumeQueue: null; updateQueue: null;
  respond: null; providers: ProviderInfo[]; settings: Settings; gitStatus: GitStatus; gitDiff: GitDiff;
  openProject: null; openExternal: null;
}
export type Method = keyof Requests;
export type AppEvent = { type: 'changed' } | { type: 'message'; message: Message } |
  { type: 'command'; command: 'new' | 'search' | 'settings' | 'sidebar' } | { type: 'appearance' } |
  { type: 'runtime-error'; error: string };
export interface MooseAPI {
  request<M extends Method>(method: M, params: Requests[M]): Promise<Responses[M]>;
  subscribe(listener: (event: AppEvent) => void): () => void;
}
export const defaultSettings: Settings = { theme: 'system', language: 'system', codexPath: '', grokPath: '', fontScale: 1 };
