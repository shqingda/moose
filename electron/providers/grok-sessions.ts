import { AcpSessions } from './acp-sessions';
export class GrokSessions extends AcpSessions {
  constructor(path: string) {
    super(path, 'grok');
  }
}
