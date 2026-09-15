import { attachmentText, promptText } from './prompt';
import { JsonRpc, type RpcCodec } from './rpc';
import {
  array,
  record,
  string,
  readable,
  type AgentAdapter,
  type AgentEvent,
  type RunContext,
} from './types';
import type { ProviderInfo } from '../../shared/types';

/** Pi RPC 是 JSONL 而非 JSON-RPC；只在边界转换信封，传输与清理逻辑共用。 */
export const piCodec: RpcCodec = {
  encode: ({ id, method, params }) => ({
    ...record(params),
    ...(id === undefined ? {} : { id: String(id) }),
    type: method,
  }),
  decode(value) {
    const event = record(value);
    if (event.type === 'response')
      return {
        id: Number(event.id),
        result: event.data,
        ...(event.success === false
          ? { error: { message: string(event.error) || 'Pi command failed' } }
          : {}),
      };
    return { method: string(event.type), params: event };
  },
};

/** message_end 是权威快照；复用块 key 覆盖增量，避免重复正文。 */
export function normalizePi(event: Record<string, unknown>, messageIndex: number): AgentEvent[] {
  const type = string(event.type),
    delta = record(event.assistantMessageEvent);
  const key = (index: unknown) => `message-${messageIndex}-${index}`;
  if (type === 'message_update' && ['text_delta', 'thinking_delta'].includes(string(delta.type))) {
    return [
      {
        key: key(delta.contentIndex),
        kind: delta.type === 'text_delta' ? 'assistant' : 'reasoning',
        delta: string(delta.delta),
        state: 'running',
      },
    ];
  }
  const message = record(event.message);
  if (type === 'message_end' && message.role === 'assistant') {
    const events: AgentEvent[] = array(message.content).flatMap((value, index): AgentEvent[] => {
      const block = record(value);
      if (block.type !== 'text' && block.type !== 'thinking') return [];
      return [
        {
          key: key(index),
          kind: block.type === 'text' ? 'assistant' : 'reasoning',
          text: string(block.text || block.thinking),
          state: 'done',
        },
      ];
    });
    if (message.stopReason === 'error')
      events.push({
        key: 'error',
        kind: 'error',
        text: string(message.errorMessage) || 'Pi model request failed',
        state: 'error',
      });
    return events;
  }
  if (type.startsWith('tool_execution_'))
    return [
      {
        key: `tool-${event.toolCallId}`,
        kind: 'tool',
        title: string(event.toolName),
        text: readable(
          type === 'tool_execution_start' ? event.args : event.result || event.partialResult,
        ),
        state: type === 'tool_execution_end' ? (event.isError ? 'error' : 'done') : 'running',
      },
    ];
  return [];
}

export class PiAdapter implements AgentAdapter {
  private rpc?: JsonRpc;
  private context?: RunContext;
  private messageIndex = 0;
  private failure?: Error;
  private cancelled = false;
  private finish?: { resolve(): void; reject(error: Error): void };
  private requests = new Map<string, Record<string, unknown>>();
  constructor(private path: string) {}

  /** 探测时禁用持久化；运行时由 Pi 保存原生 sessionFile，后续通过 --session 恢复。 */
  private connect(context?: RunContext) {
    const args = [
      '--mode',
      'rpc',
      ...(context
        ? context.session.nativeId
          ? ['--session', context.session.nativeId]
          : []
        : ['--no-session']),
    ];
    const rpc = (this.rpc = new JsonRpc(this.path, args, context?.cwd, piCodec));
    rpc.onExit = (error) => this.finish?.reject(error);
    rpc.onNotification = (type, data) => {
      if (!this.context) return;
      const event = record(data);
      if (type === 'message_start' && record(event.message).role === 'assistant') {
        this.messageIndex++;
        this.failure = undefined;
      }
      for (const normalized of normalizePi(event, this.messageIndex)) {
        this.context.emit(normalized);
        if (normalized.kind === 'error') this.failure = new Error(normalized.text);
      }
      if (type === 'extension_ui_request') this.extensionRequest(event);
      // agent_end 可能还会自动重试或压缩；必须等待会话级 settled。
      if (type === 'agent_settled') {
        if (this.failure) this.finish?.reject(this.failure);
        else this.finish?.resolve();
      }
    };
    return rpc;
  }

  /** 查询真实配置模型与逐模型推理档位，不从模型名称猜测支持的强度。 */
  async probe(): Promise<Pick<ProviderInfo, 'models' | 'modes' | 'images'>> {
    const rpc = this.connect();
    const data = record(await rpc.request('get_available_models', {}));
    const models: ProviderInfo['models'] = [];
    let images = false;
    for (const value of array(data.models)) {
      const model = record(value),
        provider = string(model.provider),
        id = string(model.id);
      if (!provider || !id) continue;
      await rpc.request('set_model', { provider, modelId: id });
      const levels = record(await rpc.request('get_available_thinking_levels', {}));
      models.push({
        id: `${provider}/${id}`,
        name: `${string(model.name) || id} · ${provider}`,
        efforts: array(levels.levels).map((level) => ({ id: string(level), label: string(level) })),
      });
      images ||= array(model.input).includes('image');
    }
    return { models, modes: [{ id: 'full', label: 'Full access' }], images };
  }

  /** 保持 Moose 自己排队；Pi 只接收当前一条输入，所有续聊都恢复指定文件。 */
  async run(context: RunContext) {
    if (context.session.mode !== 'full')
      throw new Error('Pi has no built-in approval sandbox. Select Full access to run Pi.');
    if (context.promptContext && context.promptContext.mode !== 'build')
      throw new Error('Pi does not provide native Plan or Goal mode.');
    this.context = context;
    this.failure = undefined;
    const rpc = this.connect(context);
    if (context.session.model) {
      const slash = context.session.model.indexOf('/');
      if (slash < 1) throw new Error('Select a Pi model');
      await rpc.request('set_model', {
        provider: context.session.model.slice(0, slash),
        modelId: context.session.model.slice(slash + 1),
      });
    }
    if (context.session.effort)
      await rpc.request('set_thinking_level', { level: context.session.effort });
    const state = record(await rpc.request('get_state', {}));
    if (this.cancelled) return;
    const model = record(state.model);
    if (
      (context.attachments || []).some((a) => a.mime.startsWith('image/')) &&
      !array(model.input).includes('image')
    )
      throw new Error('The selected Pi model does not support images');
    if (string(state.sessionFile)) context.nativeId(string(state.sessionFile));
    const finished = new Promise<void>((resolve, reject) => {
      this.finish = { resolve, reject };
    });
    void finished.catch(() => {});
    const files = (context.attachments || [])
      .filter((a) => !a.mime.startsWith('image/'))
      .map(attachmentText);
    await rpc.request('prompt', {
      message: [promptText(context), ...files].join('\n\n'),
      images: (context.attachments || [])
        .filter((a) => a.mime.startsWith('image/'))
        .map((a) => ({ type: 'image', data: a.data, mimeType: a.mime })),
    });
    await finished;
    if (this.cancelled) return;
    const after = record(await rpc.request('get_state', {}));
    if (string(after.sessionFile)) context.nativeId(string(after.sessionFile));
    // 用量读取失败不能把已完成的模型回复标记为执行失败。
    const stats = record(await rpc.request('get_session_stats', {}, 3000).catch(() => ({})));
    const usage = record(stats.contextUsage);
    if (typeof usage.tokens === 'number')
      context.usage?.({
        used: usage.tokens,
        capacity: typeof usage.contextWindow === 'number' ? usage.contextWindow : null,
      });
  }

  /** Pi 扩展可以提问；这些交互不代表 Pi 内置了沙箱或全局权限审批。 */
  private extensionRequest(event: Record<string, unknown>) {
    const id = string(event.id),
      method = string(event.method);
    if (!['confirm', 'select', 'input', 'editor'].includes(method)) return;
    this.requests.set(id, event);
    const text = [string(event.title), string(event.message)].filter(Boolean).join('\n');
    if (method === 'confirm')
      this.context?.emit({
        key: id,
        kind: 'approval',
        state: 'pending',
        text,
        choices: [
          { id: 'yes', label: 'Yes' },
          { id: 'no', label: 'No' },
        ],
      });
    else
      this.context?.emit({
        key: id,
        kind: 'question',
        state: 'pending',
        text,
        questions: [
          { id: 'value', text: text || method, options: array(event.options).map(string) },
        ],
      });
  }
  /** 校验并回传扩展的原始请求 ID，拒绝已经失效的交互。 */
  respond(key: string, choice?: string, answers?: Record<string, string>) {
    const request = this.requests.get(key);
    if (!request) throw new Error('Pi request is no longer active');
    if (request.method === 'confirm' && !['yes', 'no'].includes(choice || ''))
      throw new Error('Invalid Pi approval choice');
    const value = answers?.value;
    if (request.method === 'select' && !array(request.options).includes(value))
      throw new Error('Invalid Pi selection');
    this.rpc?.send({
      method: 'extension_ui_response',
      params: {
        id: key,
        ...(request.method === 'confirm' ? { confirmed: choice === 'yes' } : { value }),
      },
    });
    this.requests.delete(key);
  }
  /** 先阻止尚未发送的输入，再取消扩展等待和当前代理执行。 */
  async cancel() {
    this.cancelled = true;
    for (const id of this.requests.keys()) {
      try {
        this.rpc?.send({ method: 'extension_ui_response', params: { id, cancelled: true } });
      } catch {
        /* 进程已退出时仍要清理本地等待。 */
      }
    }
    this.requests.clear();
    await this.rpc?.request('abort', {}, 3000).catch(() => {});
    this.finish?.resolve();
  }
  /** 由公共传输层回收进程组，释放当前执行的引用。 */
  async close() {
    this.requests.clear();
    await this.rpc?.close();
    this.context = undefined;
    this.finish = undefined;
  }
}
