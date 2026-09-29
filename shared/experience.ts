import type { Message, Provider } from './types';
export interface SessionActivity {
  pendingMessageId?: string;
  queued: number;
  reason?: 'paused' | 'disabled' | 'task' | 'terminal' | 'command' | 'operation';
  target?: { sessionId?: string; terminalId?: string; commandId?: string };
}
export interface SearchHit {
  sessionId: string;
  projectId: string;
  project: string;
  title: string;
  provider: Provider;
  archived: boolean;
  messageId?: string;
  position: number;
  snippet: string;
}
export type FileReference =
  | { attachmentId: string }
  | { projectId: string; sessionId?: string; path: string };
export interface FilePreview {
  name: string;
  size: number;
  kind: 'image' | 'text' | 'download';
  content?: string;
  truncated: boolean;
}
export interface TaskNotice {
  id: string;
  sessionId: string;
  messageId?: string;
  kind: 'attention' | 'completed' | 'failed';
  project: string;
  title: string;
}
export interface ExperienceRequests {
  sessionActivity: { sessionId: string };
  searchMessages: { query: string; projectId?: string; sessionId?: string; cursor?: string };
  locateMessage: { sessionId: string; messageId: string };
  fileInfo: FileReference;
  filePreview: FileReference;
  fileDownload: FileReference;
  clientPresence: { sessionId?: string; focused: boolean };
  claimNotice: { id: string };
  notificationPermission: { request?: boolean };
  showNotification: { notice: TaskNotice; label: string };
}
export interface ExperienceResponses {
  sessionActivity: SessionActivity;
  searchMessages: { hits: SearchHit[]; cursor?: string };
  locateMessage: { messages: Message[]; hasMore: boolean; hasLater: boolean };
  fileInfo: { name: string; size: number };
  filePreview: FilePreview;
  fileDownload: null;
  clientPresence: null;
  claimNotice: TaskNotice | null;
  notificationPermission: 'granted' | 'denied' | 'default' | 'unsupported';
  showNotification: null;
}
