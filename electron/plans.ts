import type { Message, Requests } from '../shared/types';
import type { Store } from './db/store';

/** 计划版本与执行入队在同一事务中保存，刷新和重复点击不能重复批准。 */
export class Plans {
  constructor(private store: Store) {}

  private review(args: Requests['approvePlan']): Message {
    const messages = this.store.allMessages(args.sessionId);
    const plan = messages.find((m) => m.id === args.messageId);
    if (!plan || plan.kind !== 'plan' || !plan.plan || plan.state !== 'done' || !plan.text.trim())
      throw new Error('This plan is not ready for review');
    if (plan.plan.queueId) throw new Error('This plan has already been approved');
    if (plan.plan.version !== args.version)
      throw new Error('The plan changed. Review the latest version.');
    if (
      messages.findLast(
        (m) => m.kind === 'user' && (!m.delivery || m.delivery.status === 'accepted'),
      )?.runId !== plan.runId ||
      messages.findLast((m) => m.kind === 'plan')?.id !== plan.id
    )
      throw new Error('A newer conversation has replaced this plan');
    return plan;
  }

  edit(args: Requests['editPlan']) {
    const plan = this.review(args);
    return this.store.saveMessage({
      ...plan,
      text: args.text,
      seq: plan.seq + 1,
      plan: { version: plan.plan!.version + 1 },
    });
  }

  approve(args: Requests['approvePlan']) {
    return this.store.sqlite.transaction(() => {
      const plan = this.review(args);
      if (this.store.queued(args.sessionId).length)
        throw new Error('Remove or finish queued messages before approving this plan');
      const origin = this.store
        .allMessages(args.sessionId)
        .find((m) => m.runId === plan.runId && m.kind === 'user' && !m.delivery);
      const item = this.store.enqueue(
        args.sessionId,
        `Implement the following user-approved plan (version ${plan.plan!.version}). This is the approved scope; do not substitute an earlier plan.\n\n${plan.text}`,
        [],
        { mode: 'build', references: [], skills: [], subagents: origin?.context?.subagents },
      );
      this.store.saveMessage({
        ...plan,
        seq: plan.seq + 1,
        plan: { ...plan.plan!, queueId: item.id },
      });
      this.store.updateSession(args.sessionId, {
        status: 'queued',
        draftContext: {
          references: [],
          skills: [],
          ...this.store.session(args.sessionId).draftContext,
          mode: 'build',
        },
      });
      return item;
    })();
  }
}
