import { normalizeAcp } from './acp-events';
import { GrokSessions } from './grok-sessions';
import { attachmentText, promptText } from './prompt';
import { JsonRpc, RpcRejected } from './rpc';
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type RequestPermissionResponse,
} from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';
import { spawnAgent, terminate } from './process';
import { array, readable, record, string, type AgentAdapter, type RunContext } from './types';
import type { ProviderInfo } from '../../shared/types';

/** 从 Grok 握手元数据提取可选模型。 */
export function grokModels(meta: unknown): ProviderInfo['models'] {
  return array(record(record(meta).modelState).availableModels).map((value) => {
    const m = record(value);
    return {
      id: string(m.modelId),
      name: string(m.name),
      efforts: array(record(m._meta).reasoningEfforts).map((value) => {
        const e = record(value);
        return { id: string(e.value || e.id), label: string(e.label) };
      }),
    };
  });
}
export { normalizeAcp as normalizeGrok } from './acp-events';
export class GrokAdapter implements AgentAdapter {
  private billingRpc?: JsonRpc;
  private child?: ReturnType<typeof spawnAgent>;
  private connection?: ClientSideConnection;
  private initialization?: Awaited<ReturnType<ClientSideConnection['initialize']>>;
  private context?: RunContext;
  private sessionId = '';
  private chunk = 0;
  private lastKind = '';
  private cancelled = false;
  private prompting = false;
  private permissionSerial = 0;
  private permissions = new Map<
    string,
    { options: Set<string>; resolve(value: RequestPermissionResponse): void }
  >();
  private questions = new Map<
    string,
    {
      questions: { id: string; text: string; options: string[] }[];
      resolve(value: Record<string, unknown>): void;
    }
  >();
  readonly sessions: GrokSessions;
  constructor(private path: string) {
    this.sessions = new GrokSessions(path);
  }
  /** 通过 Grok billing 扩展查询套餐用量与重置时间，转换为统一额度结构。 */
  async usage(): Promise<import('../../shared/types').UsageInfo> {
    const rpc = (this.billingRpc = new JsonRpc(this.path, ['agent', 'stdio']));
    await rpc.request(
      'initialize',
      {
        protocolVersion: '1',
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      },
      10000,
    );
    const billing = record(await rpc.request('_x.ai/billing', {}, 10000));
    const config = billing.config ? record(billing.config) : billing;
    const limit = record(config.monthlyLimit).val,
      used = record(record(config.usage).totalUsed).val;
    const percent =
      typeof config.creditUsagePercent === 'number'
        ? config.creditUsagePercent
        : typeof limit === 'number' && limit > 0 && typeof used === 'number'
          ? (used / limit) * 100
          : null;
    const period = record(config.currentPeriod);
    const end =
      config.billingPeriodEnd || period.end || record(config.billingCycle).billingPeriodEnd;
    const reset = typeof end === 'string' ? Date.parse(end) / 1000 : NaN;
    const kind = string(period.type);
    return {
      context: null,
      limits: [
        {
          name: 'Grok Build',
          plan: string(billing.subscription_tier || config.subscription_tier) || null,
          windows:
            percent === null
              ? []
              : [
                  {
                    usedPercent: percent,
                    minutes: kind.includes('WEEKLY')
                      ? 10080
                      : kind.includes('DAILY')
                        ? 1440
                        : 43200,
                    resetsAt: Number.isFinite(reset) ? reset : null,
                  },
                ],
        },
      ],
    };
  }
  /** 建立 ACP 连接并注册会话更新与权限回调，拒绝当前协议不支持的权限模式。 */
  private async connect(context?: RunContext) {
    if (this.connection) return this.connection;
    const args = ['agent', '--no-leader'];
    if (context?.session.mode === 'full') args.push('--always-approve');
    if (context?.session.mode === 'auto')
      throw new Error(
        'This Grok CLI does not expose risk-based auto review over ACP. Choose Request approval or Full access.',
      );
    if (context?.session.model) args.push('--model', context.session.model);
    if (context?.session.effort) args.push('--reasoning-effort', context.session.effort);
    args.push('stdio');
    this.child = spawnAgent(this.path, args, context?.cwd);
    this.child.stderr.resume();
    // Handle spawn failures as a disconnected protocol stream, never as an uncaught EventEmitter error.
    this.child.on('error', () => this.child?.stdout.destroy());
    this.child.stdin.on('error', () => {});
    const connection = (this.connection = new ClientSideConnection(
      () => ({
        extMethod: (method, input) => {
          if (!['x.ai/ask_user_question', '_x.ai/ask_user_question'].includes(method))
            throw new Error(`Unsupported agent request: ${method}`);
          if (!this.context || this.cancelled) return { outcome: 'cancelled' };
          const params = Array.isArray(input.questions) ? input : record(input.params);
          const questions = array(params.questions).map((value) => {
            const q = record(value),
              text = string(q.question);
            return {
              id: string(q.id) || text,
              text,
              options: array(q.options).map((option) => string(record(option).label)),
            };
          });
          const key = `question:${++this.chunk}`;
          const answer = new Promise<Record<string, unknown>>((resolve) =>
            this.questions.set(key, { questions, resolve }),
          );
          this.context.emit({ key, kind: 'question', state: 'pending', questions });
          return answer;
        },
        sessionUpdate: async (params) => {
          if (!this.context || (this.sessionId && params.sessionId !== this.sessionId)) return;
          const kind = params.update.sessionUpdate;
          if (kind !== this.lastKind) this.chunk++;
          this.lastKind = kind;
          const event = normalizeAcp(params, `text:${this.chunk}`);
          if (event) this.context.emit(event);
        },
        requestPermission: (params) => {
          const key = `permission:${params.toolCall.toolCallId}:${++this.permissionSerial}`;
          if (!this.context || this.cancelled)
            return { outcome: { outcome: 'cancelled' as const } };
          const promise = new Promise<RequestPermissionResponse>((resolve) => {
            this.permissions.set(key, {
              options: new Set(params.options.map((o) => o.optionId)),
              resolve,
            });
          });
          this.context.emit({
            key,
            kind: 'approval',
            state: 'pending',
            title: params.toolCall.title || 'Tool permission',
            text: readable(params.toolCall.rawInput),
            choices: params.options.map((o) => ({ id: o.optionId, label: o.name, kind: o.kind })),
          });
          return promise;
        },
      }),
      ndJsonStream(
        Writable.toWeb(this.child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(this.child.stdout) as ReadableStream<Uint8Array>,
      ),
    ));
    this.initialization = await this.deadline(
      connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'moose', version: '0.1.0' },
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      }),
    );
    if (this.initialization.authMethods?.some((m) => m.id === 'cached_token'))
      await this.deadline(connection.authenticate({ methodId: 'cached_token' }));
    return connection;
  }
  /** 为 ACP 请求附加连接期限，避免握手或会话设置永久挂起。 */
  private async deadline<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Grok connection timed out. Check your CLI login and network.')),
            20000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  /** 返回握手声明的模型、权限档位及图片能力。 */
  async probe(): Promise<Pick<ProviderInfo, 'models' | 'modes' | 'images'>> {
    await this.connect();
    return {
      models: grokModels(this.initialization?._meta),
      modes: [
        { id: 'ask', label: 'Request approval' },
        { id: 'full', label: 'Full access' },
      ],
      images: this.initialization?.agentCapabilities?.promptCapabilities?.image === true,
    };
  }
  /** 按 ACP 能力创建或恢复会话，设置模型并发送文本、附件及引用。 */
  async run(context: RunContext) {
    if (context.promptContext?.mode === 'plan')
      throw new Error('Plan mode currently requires Codex.');
    const conn = await this.connect(context);
    if (this.cancelled) return;
    if (
      context.attachments?.some((a) => a.mime.startsWith('image/')) &&
      !this.initialization?.agentCapabilities?.promptCapabilities?.image
    )
      throw new Error('This Grok CLI does not support image input over ACP. Use Codex for images.');
    const nativeId = context.session.nativeId;
    let restored: Awaited<ReturnType<ClientSideConnection['loadSession']>>;
    if (nativeId) {
      if (!this.initialization?.agentCapabilities?.loadSession)
        throw new Error('This Grok version cannot restore sessions. Create a new session.');
      // Loading replays old messages; suppress them until the new prompt begins.
      restored = await this.deadline(
        conn.loadSession({ sessionId: nativeId, cwd: context.cwd, mcpServers: [] }),
      );
      this.sessionId = nativeId;
    } else {
      const session = await this.deadline(conn.newSession({ cwd: context.cwd, mcpServers: [] }));
      this.sessionId = session.sessionId;
      restored = session;
    }
    for (const [id, value] of [
      ['model', context.session.model],
      ['reasoning_effort', context.session.effort],
    ]) {
      if (value && restored.configOptions?.some((option) => option.id === id))
        await this.deadline(
          conn.setSessionConfigOption({ sessionId: this.sessionId, configId: id, value }),
        );
    }
    context.nativeId(this.sessionId);
    if (context.session.mode !== 'full')
      await this.deadline(
        conn.prompt({
          sessionId: this.sessionId,
          prompt: [{ type: 'text', text: '/always-approve off' }],
        }),
      );
    this.context = context;
    if (this.cancelled) return;
    this.prompting = true;
    try {
      const result = await conn.prompt({
        sessionId: this.sessionId,
        prompt: [
          {
            type: 'text',
            text: `${context.promptContext?.mode === 'goal' ? '/goal ' : ''}${promptText(context)}`,
          },
          ...(context.attachments || []).map((a) =>
            a.mime.startsWith('image/')
              ? { type: 'image' as const, mimeType: a.mime, data: a.data! }
              : {
                  type: 'text' as const,
                  text: attachmentText(a),
                },
          ),
        ],
      });
      if (result.stopReason === 'refusal')
        context.emit({
          key: 'refusal',
          kind: 'notice',
          text: 'The agent declined this request.',
          state: 'done',
        });
    } finally {
      this.prompting = false;
    }
  }
  /** 原生插话只提交一次；queued 表示底座接收，不代表模型已处理。 */
  async steer(context: RunContext): Promise<string> {
    if (!this.connection || !this.prompting || this.cancelled)
      throw new RpcRejected('The turn has ended. You can add this message to the queue.');
    if ((context.promptContext?.mode || 'build') !== (this.context?.promptContext?.mode || 'build'))
      throw new RpcRejected(
        'Steering cannot change the active task mode. Add this message to the queue.',
      );
    if (
      context.attachments?.some((a) => a.mime.startsWith('image/')) &&
      !this.initialization?.agentCapabilities?.promptCapabilities?.image
    )
      throw new RpcRejected('This Grok CLI does not support image input.');
    const text = promptText(context);
    const content = [
      { type: 'text', text },
      ...(context.attachments || []).map((a) =>
        a.mime.startsWith('image/')
          ? { type: 'image', mimeType: a.mime, data: a.data! }
          : { type: 'text', text: attachmentText(a) },
      ),
    ];
    let result: Record<string, unknown>;
    try {
      result = await this.deadline(
        this.connection.extMethod('_x.ai/interject', {
          sessionId: this.sessionId,
          text,
          content,
        }),
      );
    } catch (error) {
      // Only explicit protocol rejection proves non-delivery. Transport failures remain unknown.
      if (error instanceof RequestError && [-32601, -32602].includes(error.code))
        throw new RpcRejected(
          error.code === -32601
            ? 'This Grok CLI does not support steering. Update it or add this message to the queue.'
            : error.message,
        );
      throw error;
    }
    if (result.status !== 'queued')
      throw new Error('Unexpected Grok steering response; delivery unknown.');
    // ACP does not return a turn ID. Do not fabricate one from the session ID.
    return '';
  }
  /** 将用户选择交还当前 ACP 权限请求，仅接受代理给出的有效选项。 */
  respond(key: string, choice?: string, answers?: Record<string, string>) {
    const question = this.questions.get(key);
    if (question) {
      const response: Record<string, string[]> = {},
        annotations: Record<string, { notes: string }> = {};
      for (const q of question.questions) {
        const answer = answers?.[q.id] || '';
        response[q.text] = [q.options.includes(answer) ? answer : 'Other'];
        if (!q.options.includes(answer)) annotations[q.text] = { notes: answer };
      }
      question.resolve({ outcome: 'accepted', answers: response, annotations });
      this.questions.delete(key);
      return;
    }
    const request = this.permissions.get(key);
    if (!request) throw new Error('This request is no longer active');
    if (!choice || !request.options.has(choice)) throw new Error('Invalid approval choice');
    request.resolve({ outcome: { outcome: 'selected', optionId: choice } });
    this.permissions.delete(key);
  }
  /** 通知 ACP 取消当前输入，并释放等待权限的请求。 */
  async cancel() {
    this.cancelled = true;
    for (const pending of this.permissions.values())
      pending.resolve({ outcome: { outcome: 'cancelled' } });
    this.permissions.clear();
    if (this.connection && this.sessionId)
      await this.connection.cancel({ sessionId: this.sessionId }).catch(() => {});
    await this.close();
  }
  /** 关闭用量查询通道与代理子进程，清理未完成的等待。 */
  async close() {
    await this.sessions.close();
    await this.billingRpc?.close();
    for (const pending of this.questions.values()) pending.resolve({ outcome: 'cancelled' });
    this.questions.clear();
    for (const pending of this.permissions.values())
      pending.resolve({ outcome: { outcome: 'cancelled' } });
    this.permissions.clear();
    if (this.child) await terminate(this.child);
  }
}
