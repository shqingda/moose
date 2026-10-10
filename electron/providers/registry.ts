import type { Provider } from '../../shared/types';
import type { AgentAdapter } from './types';
// Each adapter is its own service chunk, parsed the first time that provider is probed or run.
const adapters = {
  codex: () => import('./codex').then((module) => module.CodexAdapter),
  grok: () => import('./grok').then((module) => module.GrokAdapter),
  pi: () => import('./pi').then((module) => module.PiAdapter),
  opencode: () => import('./opencode').then((module) => module.OpenCodeAdapter),
} satisfies Record<Provider, () => Promise<new (path: string) => AgentAdapter>>;
export type AdapterFactory = (
  provider: Provider,
  path: string,
) => AgentAdapter | Promise<AgentAdapter>;
/** 新增代理只注册加载器，Service 不再维护 provider 条件分支。 */
export async function createAdapter(provider: Provider, path: string): Promise<AgentAdapter> {
  return new (await adapters[provider]())(path);
}
