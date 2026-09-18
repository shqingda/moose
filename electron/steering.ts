import type { Attachment, Message, Requests } from '../shared/types';
import type { Store } from './db/store';
import { RpcRejected } from './providers/rpc';
import { providerError } from './providers/types';

/** 投递记录先落盘；超时保持结果未知，同一 requestId 永不重发。 */
export class Steering {
  private pending = new Map<string, Promise<Message>>();
  constructor(
    private store: Store,
    private emit: (message: Message) => void,
  ) {}

  send(
    args: Requests['steer'],
    runId: string,
    attachments: Attachment[],
    deliver: () => Promise<string>,
  ): Promise<Message> {
    const existing = this.store.message(args.requestId);
    if (
      existing &&
      (existing.sessionId !== args.sessionId || !existing.delivery || existing.text !== args.text)
    )
      throw new Error('The steering request ID has already been used');
    const pending = this.pending.get(args.requestId);
    if (pending) return pending;
    if (existing) return Promise.resolve(existing);
    // Attachments and references have already been resolved by the caller.
    const promise = this.deliver(args, runId, attachments, deliver);
    this.pending.set(args.requestId, promise);
    void promise.finally(() => this.pending.delete(args.requestId)).catch(() => {});
    return promise;
  }

  private async deliver(
    args: Requests['steer'],
    runId: string,
    attachments: Attachment[],
    deliver: () => Promise<string>,
  ) {
    let row = this.store.saveMessage({
      id: args.requestId,
      runId,
      sessionId: args.sessionId,
      seq: 1,
      kind: 'user',
      attachments,
      text: args.text,
      context: args.context,
      title: '',
      state: 'pending',
      delivery: { status: 'sending' },
      createdAt: Date.now(),
    });
    this.emit(row);
    try {
      const nativeTurnId = await deliver();
      row = this.store.saveMessage({
        ...row,
        nativeTurnId,
        seq: 2,
        state: 'done',
        delivery: { status: 'accepted' },
      });
    } catch (error) {
      row = this.store.saveMessage({
        ...row,
        seq: 2,
        state: 'error',
        delivery: {
          status: error instanceof RpcRejected ? 'rejected' : 'unknown',
          error: providerError(error),
        },
      });
    }
    this.emit(row);
    return row;
  }

  async settle() {
    await Promise.allSettled(this.pending.values());
  }
}
