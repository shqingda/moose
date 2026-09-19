import type {
  NativeCapabilities,
  NativeEntry,
  NativePage,
  NativeThread,
} from '../../shared/native-sessions';
import type { Session } from '../../shared/types';

export interface NativeSessions {
  capabilities(): Promise<NativeCapabilities>;
  list(cwd: string, cursor?: string): Promise<NativePage<NativeThread>>;
  read(id: string, cwd: string): Promise<NativeThread>;
  items(id: string, cwd: string, cursor?: string): Promise<NativePage<NativeEntry>>;
  fork?(session: Session, cwd: string, lastTurnId: string): Promise<NativeThread>;
  compact?(session: Session, cwd: string): Promise<void>;
  control?(id: string, action: 'send' | 'stop' | 'resume', text?: string): Promise<void>;
}
