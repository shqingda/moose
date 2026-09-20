import { randomUUID } from 'node:crypto';
import type { TerminalControl, TerminalRequests } from '../shared/terminal';

const lifetime = 15000;
/** A lease coordinates clients, not users. It is transient and never persisted with PTY output. */
export class TerminalControls {
  private leases = new Map<string, { client: string; token: string; expires: number }>();
  constructor(
    private changed: (id: string) => void,
    private now = () => performance.now(),
  ) {}
  private current(id: string) {
    const lease = this.leases.get(id);
    if (lease && lease.expires <= this.now()) {
      this.leases.delete(id);
      this.changed(id);
      return undefined;
    }
    return lease;
  }
  update(
    { id, action, lease: token }: TerminalRequests['terminalControl'],
    client: string,
  ): TerminalControl {
    let lease = this.current(id);
    if (action === 'takeover' || (action === 'acquire' && (!lease || lease.client === client))) {
      lease = { client, token: randomUUID(), expires: this.now() + lifetime };
      this.leases.set(id, lease);
      this.changed(id);
    } else if (lease?.client === client && lease.token === token) {
      if (action === 'release') {
        this.remove(id);
        lease = undefined;
      } else if (action === 'renew') lease.expires = this.now() + lifetime;
    }
    const owned =
      lease?.client === client &&
      (action === 'acquire' || action === 'takeover' || lease.token === token);
    return { owned, available: !lease, lease: owned ? lease!.token : null };
  }
  assert(id: string, client: string, token?: string) {
    const lease = this.current(id);
    if (token && (!lease || lease.token !== token || lease.client !== client))
      throw new Error('Terminal control has changed');
    if (lease && lease.client !== client)
      throw new Error('Terminal is controlled by another window');
    // Programmatic clients may send input without mounting a terminal view.
    if (!lease) this.update({ id, action: 'acquire' }, client);
  }
  remove(id: string) {
    if (this.leases.delete(id)) this.changed(id);
  }
}
