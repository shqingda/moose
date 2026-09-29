import type { TaskNotice } from '../shared/experience';
import type { Requests, Settings } from '../shared/types';
/** Ephemeral delivery only: historical snapshots never generate notifications. */
export class Notices {
  private clients = new Map<string, Requests['clientPresence'] & { at: number }>();
  private events = new Map<string, { notice: TaskNotice; at: number; claimed: boolean }>();
  constructor(private now = Date.now) {}
  presence(client: string, value: Requests['clientPresence']) {
    this.clients.set(client, { ...value, at: this.now() });
    this.prune();
  }
  private prune() {
    for (const [id, c] of this.clients) if (this.now() - c.at > 45000) this.clients.delete(id);
    for (const [id, e] of this.events) if (this.now() - e.at > 300000) this.events.delete(id);
  }
  add(notice: TaskNotice) {
    this.prune();
    if (this.events.has(notice.id)) return false;
    this.events.set(notice.id, { notice, at: this.now(), claimed: false });
    return true;
  }
  claim(id: string, client: string, settings: Settings) {
    this.prune();
    const e = this.events.get(id);
    if (!e || e.claimed || !this.clients.has(client)) return null;
    if (!(e.notice.kind === 'attention' ? settings.notifyAttention : settings.notifyResults))
      return null;
    if ([...this.clients.values()].some((c) => c.focused && c.sessionId === e.notice.sessionId)) {
      e.claimed = true;
      return null;
    }
    e.claimed = true;
    return e.notice;
  }
}
