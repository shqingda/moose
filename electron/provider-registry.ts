import { Store } from './db/store';
import { MooseError, fault } from '../shared/errors';
import { providerDefinitions, providerIds } from '../shared/providers';
import { createAdapter, type AdapterFactory } from './providers/registry';
import { discover, cliVersion } from './providers/process';
import { entitlementError } from '../shared/entitlement';
import { providerError, type AgentAdapter } from './providers/types';
import type { Provider, ProviderInfo, Requests, Settings } from '../shared/types';
import { statSync } from 'node:fs';
import { version } from '../package.json';

/** Persisted probe of one provider; valid only while the Moose build, its settings and the CLI file are unchanged. */
interface SavedProbe {
  key: string;
  mtimeMs: number;
  size: number;
  info: ProviderInfo;
}
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guarded = promise.finally(() => clearTimeout(timer));
  void guarded.catch(() => {});
  return Promise.race([
    guarded,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
const probeKey = (provider: Provider, settings: Settings) =>
  JSON.stringify([
    version,
    settings[providerDefinitions[provider].enabledKey],
    settings[providerDefinitions[provider].pathKey],
  ]);

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
  private warm?: { promise: Promise<ProviderInfo[]>; settledAt?: number };
  private probing = new Set<AgentAdapter>();
  constructor(
    private store: Store,
    private adapterFactory: AdapterFactory = createAdapter,
  ) {}

  invalidate() {
    this.providerRevision++;
    this.providerCache = undefined;
    this.warm = undefined;
    this.usageCache.clear();
  }
  /** 后台启动即开始探测；随后第一个刷新请求复用这一轮，不再重复启动 CLI。 */
  warmUp() {
    if (this.warm || this.providerCache) return;
    const warm: { promise: Promise<ProviderInfo[]>; settledAt?: number } = {
      promise: this.providers(true),
    };
    this.warm = warm;
    void warm.promise.then(
      () => (warm.settledAt = Date.now()),
      () => {
        if (this.warm === warm) this.warm = undefined;
      },
    );
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
  /** 只读上一轮探测结果（内存优先，其次磁盘上仍然有效的条目）；绝不启动探测。 */
  cachedProviders(): ProviderInfo[] {
    if (this.providerCache) return this.providerCache;
    const settings = this.store.getSettings();
    const rows = this.store.sqlite
      .prepare("SELECT value FROM settings WHERE key LIKE 'provider-probe:%'")
      .all() as { value: string }[];
    const saved = new Map<Provider, ProviderInfo>();
    for (const row of rows) {
      try {
        const entry = JSON.parse(row.value) as SavedProbe;
        if (entry.key !== probeKey(entry.info.provider, settings)) continue;
        const file = statSync(entry.info.path);
        if (file.mtimeMs !== entry.mtimeMs || file.size !== entry.size) continue;
        saved.set(entry.info.provider, entry.info);
      } catch {
        // A removed CLI or unreadable row is simply not shown until the fresh probe lands.
      }
    }
    return providerIds.flatMap((provider) => saved.get(provider) ?? []);
  }
  private persist(results: ProviderInfo[], settings: Settings) {
    const upsert = this.store.sqlite.prepare(
      'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    );
    const remove = this.store.sqlite.prepare('DELETE FROM settings WHERE key=?');
    for (const info of results) {
      const key = 'provider-probe:' + info.provider;
      try {
        if (info.error || !info.path) {
          remove.run(key);
          continue;
        }
        const file = statSync(info.path);
        const entry: SavedProbe = {
          key: probeKey(info.provider, settings),
          mtimeMs: file.mtimeMs,
          size: file.size,
          info,
        };
        upsert.run(key, JSON.stringify(entry));
      } catch {
        remove.run(key);
      }
    }
  }
  /** 并行探测代理版本与能力；缓存结果，并合并重复探测请求。 */
  async providers(refresh = false): Promise<ProviderInfo[]> {
    if (refresh && this.warm) {
      const warm = this.warm;
      this.warm = undefined;
      if (warm.settledAt === undefined || Date.now() - warm.settledAt < 10_000) return warm.promise;
    }
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
            Object.assign(
              info,
              await withTimeout(adapter.probe(), 12000, 'Provider probe timed out'),
            );
            info.taskModes ??= [...providerDefinitions[provider].taskModes];
            info.steering ??= typeof adapter.steer === 'function';
            if (info.failure || info.error) {
              info.connected = false;
              info.error ||= info.failure?.message;
              if (info.failure?.code === 'subscription' || info.failure?.code === 'auth')
                info.models = info.models.map((model) => ({ ...model, unavailable: true }));
            } else {
              info.connected = true;
              this.store.clearUnavailable(provider);
            }
            const blocked = new Set(this.store.unavailableModels()[provider] || []);
            if (blocked.size)
              info.models = info.models.map((model) =>
                blocked.has(model.id) ? { ...model, unavailable: true } : model,
              );
          } catch (error) {
            const entitlement = entitlementError(error);
            info.error = entitlement?.message || providerError(error);
            info.failure = entitlement ? fault(entitlement) : fault(error);
            if (info.failure.code === 'subscription' || info.failure.code === 'auth')
              info.models = info.models.map((model) => ({ ...model, unavailable: true }));
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
      try {
        this.persist(results, settings);
      } catch {
        // The on-disk copy only speeds up the next start; a closed or busy store must not fail the probe.
      }
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
        const entitlement = entitlementError(error);
        return {
          ...(cached?.value || { limits: [] }),
          context,
          error: entitlement?.message || providerError(error),
        };
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

  rememberUnavailable(provider: Provider, model: string) {
    this.store.rememberUnavailable(provider, model);
    this.providerCache = this.providerCache?.map((info) =>
      info.provider === provider
        ? {
            ...info,
            models: info.models.map((item) =>
              item.id === model ? { ...item, unavailable: true } : item,
            ),
          }
        : info,
    );
  }
  async close() {
    this.stopping = true;
    await Promise.all([...this.probing].map((adapter) => adapter.close()));
    await Promise.allSettled([this.probePromise, ...this.usagePending.values()]);
  }
}
