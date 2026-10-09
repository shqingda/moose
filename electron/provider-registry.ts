import { Store } from './db/store';
import { MooseError, fault } from '../shared/errors';
import { providerDefinitions, providerIds } from '../shared/providers';
import { createAdapter, type AdapterFactory } from './providers/registry';
import { discover, cliVersion } from './providers/process';
import { providerError, type AgentAdapter } from './providers/types';
import type { Provider, ProviderInfo, Requests } from '../shared/types';

/** Own discovery, capability probes and quotas; never owns task or directory locks. */
export class ProviderRegistry {
  private stopping = false;
  private usageCache = new Map<
    Provider,
    { at: number; value: import('../shared/types').UsageInfo }
  >();
  private usagePending = new Map<Provider, Promise<import('../shared/types').UsageInfo>>();
  private providerCache?: ProviderInfo[];
  private providerRevision = 0;
  private probePromise?: Promise<ProviderInfo[]>;
  private probing = new Set<AgentAdapter>();
  constructor(
    private store: Store,
    private adapterFactory: AdapterFactory = createAdapter,
  ) {}

  invalidate() {
    this.providerRevision++;
    this.providerCache = undefined;
    this.usageCache.clear();
  }
  /** 根据用户配置或默认搜索路径定位本机代理 CLI。 */
  async path(provider: Provider) {
    const settings = this.store.getSettings();
    try {
      return await discover(provider, settings[providerDefinitions[provider].pathKey]);
    } catch (error) {
      throw new MooseError('provider', String(error));
    }
  }
  /** 并行探测代理版本与能力；缓存结果，并合并重复探测请求。 */
  async providers(refresh = false): Promise<ProviderInfo[]> {
    if (!refresh && this.providerCache) return this.providerCache;
    if (this.probePromise) return this.probePromise;
    this.probePromise = this.probeProviders();
    try {
      return await this.probePromise;
    } finally {
      this.probePromise = undefined;
    }
  }
  /** 一轮使用同一份配置；保存期间过期的结果不返回、不缓存，合并到最新配置重试。 */
  private async probeProviders(): Promise<ProviderInfo[]> {
    while (true) {
      const revision = this.providerRevision;
      const settings = this.store.getSettings();
      const results = await Promise.all(
        providerIds.map(async (provider) => {
          const info: ProviderInfo = {
            enabled: settings[providerDefinitions[provider].enabledKey],
            provider,
            path: '',
            version: '',
            available: false,
            connected: false,
            models: [],
            modes: [],
          };
          let adapter: AgentAdapter | undefined;
          try {
            info.path = await discover(provider, settings[providerDefinitions[provider].pathKey]);
            info.available = true;
            info.version = await cliVersion(info.path);
            if (this.stopping || !info.enabled) return info;
            adapter = await this.adapterFactory(provider, info.path);
            this.probing.add(adapter);
            if (this.stopping) return info;
            Object.assign(info, await adapter.probe());
            info.taskModes ??= [...providerDefinitions[provider].taskModes];
            info.steering ??= typeof adapter.steer === 'function';
            info.connected = true;
          } catch (error) {
            info.error = providerError(error);
            info.failure = fault(error);
          } finally {
            if (adapter) {
              await adapter.close();
              this.probing.delete(adapter);
            }
          }
          return info;
        }),
      );
      if (this.stopping) return results;
      if (revision !== this.providerRevision) continue;
      this.providerCache = results;
      return results;
    }
  }
  async usage(a: Requests['usage']) {
    if (a.sessionId && this.store.session(a.sessionId).provider !== a.provider)
      throw new Error('Provider does not match session');
    const saved = a.sessionId
      ? (this.store.sqlite
          .prepare('SELECT value FROM settings WHERE key = ?')
          .get('usage:' + a.sessionId) as { value: string } | undefined)
      : undefined;
    const context = saved ? JSON.parse(saved.value) : null;
    let cached = this.usageCache.get(a.provider);
    if (!cached || Date.now() - cached.at > 60000) {
      let pending = this.usagePending.get(a.provider);
      if (!pending) {
        pending = (async () => {
          const revision = this.providerRevision;
          const path = await this.path(a.provider);
          if (this.stopping) throw new Error('Moose is shutting down');
          const adapter = await this.adapterFactory(a.provider, path);
          this.probing.add(adapter);
          try {
            if (this.stopping) throw new Error('Moose is shutting down');
            const value = (await adapter.usage?.()) || { context: null, limits: [] };
            if (revision === this.providerRevision)
              this.usageCache.set(a.provider, { at: Date.now(), value });
            return value;
          } finally {
            await adapter.close();
            this.probing.delete(adapter);
          }
        })();
        this.usagePending.set(a.provider, pending);
        void pending.finally(() => this.usagePending.delete(a.provider)).catch(() => {});
      }
      try {
        await pending;
      } catch (error) {
        return { ...(cached?.value || { limits: [] }), context, error: providerError(error) };
      }
      cached = this.usageCache.get(a.provider);
    }
    return {
      ...(cached?.value || { limits: [] }),
      context:
        context ||
        (!a.sessionId || !this.store.allMessages(a.sessionId).length
          ? { used: 0, capacity: null }
          : null),
    };
  }

  async close() {
    this.stopping = true;
    await Promise.all([...this.probing].map((adapter) => adapter.close()));
    await Promise.allSettled([this.probePromise, ...this.usagePending.values()]);
  }
}
