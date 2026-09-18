import type { Choice, Message, ProviderInfo, Question, Session } from '../../shared/types';
export type AgentEvent = {
  key: string;
  kind: Message['kind'];
  text?: string;
  delta?: string;
  title?: string;
  state?: Message['state'];
  choices?: Choice[];
  questions?: Question[];
  delegation?: Message['delegation'];
};
export interface RunContext {
  usage?(usage: import('../../shared/types').ContextUsage): void;
  promptContext?: import('../../shared/types').PromptContext;
  selection?: {
    references: import('../../shared/types').ContextEntry[];
    skills: import('../../shared/types').ContextEntry[];
  };
  session: Session;
  cwd: string;
  text: string;
  attachments?: import('../attachments').AgentAttachment[];
  turnId?(id: string): void;
  emit(event: AgentEvent): void;
  nativeId(id: string): void;
}
export interface AgentAdapter {
  usage?(): Promise<import('../../shared/types').UsageInfo>;
  probe(): Promise<Pick<ProviderInfo, 'models' | 'modes' | 'images'>>;
  fork?(session: Session, cwd: string, lastTurnId: string): Promise<string>;
  run(context: RunContext): Promise<void>;
  respond(key: string, choice?: string, answers?: Record<string, string>): void;
  cancel(): Promise<void>;
  close(): Promise<void>;
}
/** 把未知协议值收窄为对象，非对象回退为空对象。 */
export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
/** 提取协议字符串，其他类型回退空字符串。 */
export function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
/** 提取协议数组，其他类型回退空数组。 */
export function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
/** 将协议数据转为可展示文本，保留结构化对象的缩进。 */
export function readable(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2);
}
/** 优先提取代理返回的错误详情，再回退普通异常信息。 */
export function providerError(error: unknown): string {
  const detail = record(record(error).data);
  return string(detail.message) || (error instanceof Error ? error.message : String(error));
}
