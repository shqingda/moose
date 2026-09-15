import type { Provider } from '../../shared/types';
import type { AgentAdapter } from './types';
import { CodexAdapter } from './codex';
import { GrokAdapter } from './grok';
import { PiAdapter } from './pi';
const adapters = { codex: CodexAdapter, grok: GrokAdapter, pi: PiAdapter } satisfies Record<
  Provider,
  new (path: string) => AgentAdapter
>;
/** 新增代理只注册构造器，Service 不再维护 provider 条件分支。 */
export function createAdapter(provider: Provider, path: string): AgentAdapter {
  return new adapters[provider](path);
}
