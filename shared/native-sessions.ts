import type { Message } from './types';

export interface NativeThread {
  id: string;
  title: string;
  cwd: string;
  updatedAt: number;
  parentId: string | null;
  forkedFromId: string | null;
  status: 'active' | 'idle' | 'notLoaded' | 'error' | 'unknown';
  model: string;
  effort: string;
  canAcceptInput: boolean;
}
export interface NativeEntry {
  id: string;
  turnId: string;
  kind: Message['kind'];
  delegation?: Message['delegation'];
  text: string;
  title: string;
}
export interface NativePage<T> {
  data: T[];
  nextCursor: string | null;
}
export interface NativeOrigin {
  kind: 'import' | 'fork';
  sourceNativeId: string;
  sourceSessionId?: string;
  forkTurnId?: string;
  at: number;
}
export interface NativeCapabilities {
  history: boolean;
  fork: boolean;
  compact: boolean;
  children: boolean;
  reason?: string;
}
export interface ChildThread {
  id: string;
  parentId: string;
  status: string;
  message: string;
  model?: string;
}
