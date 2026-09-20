import { homedir } from 'node:os';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import { JsonRpc } from './rpc';
import { cliVersion } from './process';
import { normalizeAcp } from './acp-events';
import { attachmentText, promptText } from './prompt';
import { array, record, string, readable, type AgentAdapter, type RunContext } from './types';
import type { ProviderInfo, ModelOption } from '../../shared/types';

/** OpenCode v2 ACP: private server owned by the CLI, never a scraped terminal. */
export class OpenCodeAdapter implements AgentAdapter {
  private rpc?: JsonRpc;
  private initialization: Record<string, unknown> = {};
  private context?: RunContext;
  private sessionId = '';
  private chunk = 0;
  private kind = '';
  private cancelled = false;
  private pending = new Map<string, { id: number | string; options: Set<string> }>();
  constructor(private path: string) {}
  private async connect(cwd?: string) {
    if (this.rpc) return this.rpc;
    const version = await cliVersion(this.path);
    if (this.cancelled) throw new Error('OpenCode connection was cancelled');
    if (!/(?:^|\s|v)2\./.test(version))
      throw new Error('OpenCode v2 is required. Install opencode-v2 or select its executable.');
    const rpc = (this.rpc = new JsonRpc(this.path, ['acp'], cwd, {
      encode: (value) => ({ jsonrpc: '2.0', ...value }),
      decode: (value) => value as import('./rpc').RpcMessage,
    }));
    rpc.onNotification = (method, value) => {
      const params = record(value);
      if (method !== 'session/update' || !this.context || params.sessionId !== this.sessionId)
        return;
      const kind = string(record(params.update).sessionUpdate);
      if (kind !== this.kind) this.chunk++;
      this.kind = kind;
      const event = normalizeAcp(params as unknown as SessionNotification, `text:${this.chunk}`);
      if (event) this.context.emit(event);
    };
    rpc.onRequest = (id, method, value) => {
      const params = record(value);
      if (method !== 'session/request_permission') {
        rpc.send({ id, error: { code: -32601, message: 'Unsupported client capability' } });
        return;
      }
      if (!this.context || this.cancelled || params.sessionId !== this.sessionId) {
        rpc.send({ id, result: { outcome: { outcome: 'cancelled' } } });
        return;
      }
      const key = `permission:${id}`;
      const choices = array(params.options).map((value) => {
        const row = record(value);
        return { id: string(row.optionId), label: string(row.name), kind: string(row.kind) };
      });
      this.pending.set(key, { id, options: new Set(choices.map((row) => row.id)) });
      const tool = record(params.toolCall);
      this.context.emit({
        key,
        kind: 'approval',
        state: 'pending',
        title: string(tool.title) || 'Tool permission',
        text: readable(tool.rawInput),
        choices,
      });
    };
    this.initialization = record(
      await rpc.request('initialize', {
        protocolVersion: 1,
        clientInfo: { name: 'moose', version: '0.14.0' },
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      }),
    );
    return rpc;
  }
  async probe(): Promise<Pick<ProviderInfo, 'models' | 'modes' | 'images'>> {
    const rpc = await this.connect();
    const session = record(await rpc.request('session/new', { cwd: homedir(), mcpServers: [] }));
    const options = array(session.configOptions).map(record);
    const model = options.find((row) => row.category === 'model' || row.id === 'model');
    const flatten = (rows: unknown[]): ModelOption[] =>
      rows.flatMap((value) => {
        const row = record(value);
        return Array.isArray(row.options)
          ? flatten(row.options)
          : [{ id: string(row.value), name: string(row.name), efforts: [] }];
      });
    return {
      models: model
        ? flatten(array(model.options))
        : array(record(session.models).availableModels).map((value) => {
            const row = record(value);
            return { id: string(row.modelId), name: string(row.name), efforts: [] };
          }),
      modes: [{ id: 'ask', label: 'Request approval' }],
      images:
        record(record(this.initialization.agentCapabilities).promptCapabilities).image === true,
    };
  }
  async run(context: RunContext) {
    if (context.session.mode && context.session.mode !== 'ask')
      throw new Error('OpenCode currently supports Request approval mode in Moose.');
    if (context.promptContext && context.promptContext.mode !== 'build')
      throw new Error('This OpenCode integration currently supports Build mode.');
    const rpc = await this.connect(context.cwd);
    if (this.cancelled) return;
    const nativeId = context.session.nativeId;
    if (nativeId && !record(this.initialization.agentCapabilities).loadSession)
      throw new Error('This OpenCode CLI cannot restore sessions.');
    const session = record(
      await rpc.request(nativeId ? 'session/load' : 'session/new', {
        ...(nativeId ? { sessionId: nativeId } : {}),
        cwd: context.cwd,
        mcpServers: [],
      }),
    );
    this.sessionId = nativeId || string(session.sessionId);
    if (!this.sessionId) throw new Error('OpenCode returned no session ID');
    context.nativeId(this.sessionId);
    const options = array(session.configOptions).map(record);
    for (const [category, selected] of [
      ['model', context.session.model],
      ['thought_level', context.session.effort],
    ]) {
      if (!selected) continue;
      const option = options.find((row) => row.category === category || row.id === category);
      if (!option) throw new Error(`OpenCode did not advertise the selected ${category} option`);
      await rpc.request('session/set_config_option', {
        sessionId: this.sessionId,
        configId: option.id,
        value: selected,
      });
    }
    if (
      context.attachments?.some((a) => a.mime.startsWith('image/')) &&
      !record(record(this.initialization.agentCapabilities).promptCapabilities).image
    )
      throw new Error('OpenCode did not advertise image input support');
    if (this.cancelled) return;
    this.context = context;
    try {
      const result = record(
        await rpc.request(
          'session/prompt',
          {
            sessionId: this.sessionId,
            prompt: [
              { type: 'text', text: promptText(context) },
              ...(context.attachments || []).map((a) =>
                a.mime.startsWith('image/')
                  ? { type: 'image', mimeType: a.mime, data: a.data }
                  : { type: 'text', text: attachmentText(a) },
              ),
            ],
          },
          24 * 60 * 60 * 1000,
        ),
      );
      if (result.stopReason === 'refusal')
        context.emit({
          key: 'refusal',
          kind: 'notice',
          text: 'The agent declined this request.',
          state: 'done',
        });
    } finally {
      this.context = undefined;
    }
  }
  respond(key: string, choice?: string) {
    const request = this.pending.get(key);
    if (!request || !choice || !request.options.has(choice))
      throw new Error('Invalid or expired approval');
    this.rpc!.send({
      id: request.id,
      result: { outcome: { outcome: 'selected', optionId: choice } },
    });
    this.pending.delete(key);
  }
  async cancel() {
    this.cancelled = true;
    if (this.rpc && this.sessionId)
      this.rpc.send({ method: 'session/cancel', params: { sessionId: this.sessionId } });
    await this.close();
  }
  async close() {
    this.cancelled = true;
    this.pending.clear();
    await this.rpc?.close();
  }
}
