import { attachmentText } from './prompt';
import { JsonRpc } from './rpc';
import {
  array,
  readable,
  record,
  string,
  type AgentAdapter,
  type AgentEvent,
  type RunContext,
} from './types';
import type { ModelListResponse } from './generated/codex/v2/ModelListResponse';
import type { ThreadStartParams } from './generated/codex/v2/ThreadStartParams';
import type { TurnStartParams } from './generated/codex/v2/TurnStartParams';
import type { ReasoningEffort } from './generated/codex/ReasoningEffort';
import type { ProviderInfo } from '../../shared/types';

/** 把界面权限档位映射为 Codex 审批策略、审批人和沙箱配置。 */
export function codexPermissions(
  mode: string,
): Pick<ThreadStartParams, 'approvalPolicy' | 'approvalsReviewer' | 'sandbox' | 'config'> {
  return mode === 'full'
    ? { approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: 'danger-full-access' }
    : {
        approvalPolicy: 'on-request',
        approvalsReviewer: mode === 'auto' ? 'auto_review' : 'user',
        sandbox: 'workspace-write',
        config: { 'sandbox_workspace_write.network_access': false, web_search: 'disabled' },
      };
}

/** 把 Codex 通知转换为统一消息事件，屏蔽协议字段差异。 */
export function normalizeCodex(method: string, input: unknown): AgentEvent | null {
  const p = record(input),
    item = record(p.item);
  const key = string(p.itemId) || string(item.id);
  if (method === 'item/agentMessage/delta')
    return { key, kind: 'assistant', delta: string(p.delta), state: 'running' };
  if (method === 'item/reasoning/summaryTextDelta' || method === 'item/reasoning/textDelta')
    return { key, kind: 'reasoning', delta: string(p.delta), state: 'running' };
  if (method === 'item/commandExecution/outputDelta')
    return { key, kind: 'tool', delta: string(p.delta), state: 'running' };
  if (method !== 'item/started' && method !== 'item/completed') return null;
  const state = method === 'item/started' ? 'running' : item.status === 'failed' ? 'error' : 'done';
  switch (item.type) {
    case 'agentMessage':
      return { key, kind: 'assistant', text: string(item.text), state };
    case 'reasoning': {
      const text =
        array(item.summary).map(string).filter(Boolean).join('\n') ||
        array(item.content).map(string).filter(Boolean).join('\n');
      return { key, kind: 'reasoning', ...(text ? { text } : {}), state };
    }
    case 'commandExecution':
      return {
        key,
        kind: 'tool',
        title: string(item.command),
        text: string(item.aggregatedOutput),
        state,
      };
    case 'fileChange':
      return {
        key,
        kind: 'tool',
        title: 'File changes',
        text: array(item.changes)
          .map((change) => {
            const c = record(change);
            return `${string(c.path)}\n${string(c.diff)}`;
          })
          .join('\n'),
        state,
      };
    case 'mcpToolCall':
      return {
        key,
        kind: 'tool',
        title: `${string(item.server)} / ${string(item.tool)}`,
        text: readable(item.result ?? item.arguments ?? item.error),
        state,
      };
    case 'plan':
      return { key, kind: 'assistant', title: 'Plan', text: string(item.text), state };
    case 'webSearch':
      return { key, kind: 'tool', title: 'Web search', text: string(item.query), state };
    default:
      return null;
  }
}
export class CodexAdapter implements AgentAdapter {
  private rpc?: JsonRpc;
  private context?: RunContext;
  private turnId = '';
  private threadId = '';
  private requests = new Map<
    string,
    {
      id: number | string;
      method: string;
      options: Set<string>;
      permissions?: Record<string, unknown>;
    }
  >();
  private finish?: { resolve(): void; reject(error: Error): void };
  private cancelled = false;
  private pursuingGoal = false;
  constructor(private path: string) {}
  /** 启动 app-server 并握手，注册流式通知、审批及提问的回调。 */
  private async connect(cwd?: string) {
    if (this.rpc) return this.rpc;
    const rpc = (this.rpc = new JsonRpc(this.path, ['app-server'], cwd));
    rpc.onExit = (error) => this.finish?.reject(error);
    rpc.onNotification = (method, params) => {
      const p = record(params);
      if (!this.context || (p.threadId && p.threadId !== this.threadId)) return;
      if (method === 'thread/tokenUsage/updated') {
        const usage = record(p.tokenUsage),
          last = record(usage.last);
        if (typeof last.totalTokens === 'number')
          this.context.usage?.({
            used: last.totalTokens,
            capacity:
              typeof usage.modelContextWindow === 'number' ? usage.modelContextWindow : null,
          });
      }
      if (method === 'turn/started') {
        this.turnId = string(record(p.turn).id);
        this.context.turnId?.(this.turnId);
      }
      if (method === 'turn/completed') {
        const turn = record(p.turn);
        if (turn.status === 'failed')
          this.finish?.reject(new Error(string(record(turn.error).message) || 'Codex turn failed'));
        else if (this.pursuingGoal && !this.cancelled) {
          void rpc
            .request('thread/goal/get', { threadId: this.threadId })
            .then((result) => {
              const goal = record(record(result).goal);
              if (goal.status !== 'active') {
                this.context?.emit({
                  key: 'goal-status',
                  kind: 'notice',
                  text: `Goal: ${string(goal.status)}`,
                  state: 'done',
                });
                this.finish?.resolve();
              }
            })
            .catch((error) => this.finish?.reject(error));
        } else this.finish?.resolve();
      }
      const event = normalizeCodex(method, params);
      if (event?.key) this.context.emit(event);
    };
    rpc.onRequest = (id, method, input) => {
      const p = record(input),
        key = `request:${id}`;
      if (!this.context || (p.threadId && p.threadId !== this.threadId)) {
        rpc.send({ id, error: { code: -32601, message: 'No active Moose session' } });
        return;
      }
      if (
        method === 'item/commandExecution/requestApproval' ||
        method === 'item/fileChange/requestApproval' ||
        method === 'item/permissions/requestApproval'
      ) {
        if (this.context.promptContext?.mode === 'plan') {
          rpc.send({
            id,
            result:
              method === 'item/permissions/requestApproval'
                ? { permissions: {}, scope: 'turn' }
                : { decision: 'decline' },
          });
          return;
        }
        const choices = [
          { id: 'accept', label: 'Allow once' },
          { id: 'decline', label: 'Deny' },
        ];
        this.requests.set(key, {
          id,
          method,
          options: new Set(choices.map((c) => c.id)),
          permissions: record(p.permissions),
        });
        this.context.emit({
          key,
          kind: 'approval',
          title:
            string(p.command) ||
            (p.permissions ? 'Additional permissions' : 'File change approval'),
          text: [string(p.reason), readable(p.permissions || p.changes)].filter(Boolean).join('\n'),
          choices,
          state: 'pending',
        });
      } else if (method === 'item/tool/requestUserInput') {
        this.requests.set(key, { id, method, options: new Set() });
        this.context.emit({
          key,
          kind: 'question',
          title: '',
          state: 'pending',
          questions: array(p.questions).map((value) => {
            const q = record(value);
            return {
              id: string(q.id),
              text: string(q.question),
              options: array(q.options).map((o) => string(record(o).label)),
              secret: q.isSecret === true,
            };
          }),
        });
      } else
        rpc.send({ id, error: { code: -32601, message: `Moose does not implement ${method}` } });
    };
    await rpc.request('initialize', {
      clientInfo: { name: 'moose', title: 'Moose', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    });
    rpc.send({ method: 'initialized', params: {} });
    return rpc;
  }
  /** 读取账号额度窗口；优先保留不同模型额度桶，不根据套餐名推测限制。 */
  async usage(): Promise<import('../../shared/types').UsageInfo> {
    const rpc = await this.connect();
    const result = await rpc.request<
      import('./generated/codex/v2/GetAccountRateLimitsResponse').GetAccountRateLimitsResponse
    >('account/rateLimits/read', {});
    const buckets =
      result.rateLimitsByLimitId && Object.keys(result.rateLimitsByLimitId).length
        ? Object.values(result.rateLimitsByLimitId)
        : [result.rateLimits];
    return {
      context: null,
      limits: buckets
        .filter((b) => !!b)
        .map((b) => ({
          name: b!.limitName || b!.limitId || 'Codex',
          plan: b!.planType,
          windows: [b!.primary, b!.secondary]
            .filter((w) => !!w)
            .map((w) => ({
              usedPercent: w!.usedPercent,
              minutes: w!.windowDurationMins,
              resetsAt: w!.resetsAt,
            })),
        })),
    };
  }
  /** 查询真实模型与推理强度，返回界面可选择的能力。 */
  async probe(): Promise<Pick<ProviderInfo, 'models' | 'modes' | 'images'>> {
    const rpc = await this.connect();
    const result = await rpc.request<ModelListResponse>('model/list', {
      limit: 100,
      includeHidden: false,
    });
    const account = record(await rpc.request('account/read', { refreshToken: false }));
    if (!account.account) throw new Error('Sign in with `codex login`, then reconnect.');
    return {
      models: result.data
        .filter((m) => !m.hidden)
        .map((m) => ({
          id: m.model,
          name: m.displayName,
          efforts: m.supportedReasoningEfforts.map((e) => ({
            id: e.reasoningEffort,
            label: e.reasoningEffort,
          })),
        })),
      modes: [
        { id: 'ask', label: 'Request approval' },
        { id: 'auto', label: 'Approve for me' },
        { id: 'full', label: 'Full access' },
      ],
      images: true,
    };
  }
  /** 创建或恢复原生 thread，发送本轮输入，并等待普通任务或 Goal 结束。 */
  async run(context: RunContext) {
    this.context = context;
    const rpc = await this.connect(context.cwd);
    if (this.cancelled) return;
    const planning = context.promptContext?.mode === 'plan';
    const params: ThreadStartParams = {
      cwd: context.cwd,
      ...codexPermissions(context.session.mode),
      developerInstructions: planning
        ? 'Moose Plan mode: explore with read-only tools, ask clarifying questions when needed, and produce an implementation plan. Do not modify files, execute changes, or use tools that mutate external state.'
        : '',
      ...(planning
        ? ({
            sandbox: 'read-only',
            approvalPolicy: 'never',
            approvalsReviewer: 'user',
            config: { web_search: 'disabled' },
          } as const)
        : {}),
      ...(context.session.model ? { model: context.session.model } : {}),
    };
    const result = record(
      await rpc.request(
        context.session.nativeId ? 'thread/resume' : 'thread/start',
        context.session.nativeId ? { ...params, threadId: context.session.nativeId } : params,
      ),
    );
    this.threadId = string(record(result.thread).id);
    if (!this.threadId) throw new Error('Codex did not return a thread ID');
    context.nativeId(this.threadId);
    if (this.cancelled) return;
    if (context.promptContext?.mode === 'goal') {
      if (context.text.length > 4000)
        throw new Error('Goal objectives are limited to 4,000 characters.');
      await rpc.request('thread/goal/set', {
        threadId: this.threadId,
        objective: context.text,
        status: 'paused',
        ...(context.promptContext.goalBudget
          ? { tokenBudget: context.promptContext.goalBudget }
          : {}),
      });
    }
    const completed = new Promise<void>((resolve, reject) => {
      this.finish = { resolve, reject };
    });
    // Attach a handler before turn/start, since early errors may arrive before its response.
    void completed.catch(() => {});
    const turn: TurnStartParams = {
      summary: 'auto',
      threadId: this.threadId,
      input: [
        { type: 'text', text: context.text, text_elements: [] },
        ...(context.selection?.references || []).map((a) => ({
          type: 'mention' as const,
          name: a.name,
          path: a.path,
        })),
        ...(context.selection?.skills || []).map((a) => ({
          type: 'skill' as const,
          name: a.name,
          path: a.path,
        })),
        ...(context.attachments || []).flatMap((a): TurnStartParams['input'] =>
          a.mime.startsWith('image/')
            ? [{ type: 'localImage', path: a.path }]
            : [
                {
                  type: 'text',
                  text: attachmentText(a),
                  text_elements: [],
                },
              ],
        ),
      ],
      ...(context.session.model ? { model: context.session.model } : {}),
      ...(context.session.effort ? { effort: context.session.effort as ReasoningEffort } : {}),
    };
    const started = record(await rpc.request('turn/start', turn));
    this.turnId = string(record(started.turn).id) || this.turnId;
    context.turnId?.(this.turnId);
    if (this.cancelled) await this.cancel();
    await completed;
    if (context.promptContext?.mode === 'goal' && !this.cancelled) {
      const goal = record(
        record(await rpc.request('thread/goal/get', { threadId: this.threadId })).goal,
      );
      if (
        goal.status === 'complete' ||
        goal.status === 'blocked' ||
        goal.status === 'budgetLimited' ||
        goal.status === 'usageLimited'
      )
        return;
      this.pursuingGoal = true;
      const pursuit = new Promise<void>((resolve, reject) => {
        this.finish = { resolve, reject };
      });
      void pursuit.catch(() => {});
      await rpc.request('thread/goal/set', { threadId: this.threadId, status: 'active' });
      if (this.cancelled) await this.cancel();
      await pursuit;
    }
  }
  /** 从指定原生 turn 准备编辑前的上下文；不会创建新的 Moose 侧栏会话。 */
  async fork(session: RunContext['session'], cwd: string, lastTurnId: string) {
    const rpc = await this.connect(cwd);
    const result = record(
      await rpc.request('thread/fork', {
        threadId: session.nativeId,
        lastTurnId,
        cwd,
        ...codexPermissions(session.mode),
      }),
    );
    const id = string(record(result.thread).id);
    if (!id) throw new Error('Codex did not return the restored thread');
    return id;
  }
  /** 校验答案选项并关联回原始 JSON-RPC 请求，防止批准错误的操作。 */
  respond(key: string, choice?: string, answers?: Record<string, string>) {
    const request = this.requests.get(key);
    if (!request || !this.rpc) throw new Error('This request is no longer active');
    if (request.method === 'item/tool/requestUserInput')
      this.rpc.send({
        id: request.id,
        result: {
          answers: Object.fromEntries(
            Object.entries(answers || {}).map(([id, answer]) => [id, { answers: [answer] }]),
          ),
        },
      });
    else if (request.method === 'item/permissions/requestApproval') {
      if (!choice || !request.options.has(choice)) throw new Error('Invalid approval choice');
      this.rpc.send({
        id: request.id,
        result: {
          permissions:
            choice === 'accept'
              ? Object.fromEntries(
                  Object.entries(request.permissions || {}).filter(([, value]) => value != null),
                )
              : {},
          scope: 'turn',
        },
      });
    } else {
      if (!choice || !request.options.has(choice)) throw new Error('Invalid approval choice');
      this.rpc.send({ id: request.id, result: { decision: choice } });
    }
    this.requests.delete(key);
  }
  /** 先暂停 Goal，再中断当前 turn；取消期间容忍代理已退出。 */
  async cancel() {
    this.cancelled = true;
    if (this.context?.promptContext?.mode === 'goal' && this.rpc && this.threadId)
      await this.rpc
        .request('thread/goal/set', { threadId: this.threadId, status: 'paused' }, 3000)
        .catch(() => {});
    if (this.rpc && this.threadId && this.turnId)
      await this.rpc
        .request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId }, 3000)
        .catch(() => {});
    this.finish?.resolve();
  }
  /** 暂停仍活跃的 Goal，清空待处理请求并关闭 CLI 通道。 */
  async close() {
    if (this.context?.promptContext?.mode === 'goal' && this.rpc && this.threadId) {
      const result = await this.rpc
        .request('thread/goal/get', { threadId: this.threadId }, 3000)
        .catch(() => null);
      if (record(record(result).goal).status === 'active')
        await this.rpc
          .request('thread/goal/set', { threadId: this.threadId, status: 'paused' }, 3000)
          .catch(() => {});
    }
    this.requests.clear();
    this.finish = undefined;
    await this.rpc?.close();
  }
}
