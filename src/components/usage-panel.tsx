import { useContext, useEffect, useState } from 'react';
import type { Provider, UsageInfo } from '../../shared/types';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
import { Button } from './ui/button';
import { useI18n, LocaleContext } from '../lib/i18n';
const cache = new Map<string, UsageInfo>();
const tokens = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));
/** 打开时查询上下文与额度，保留缓存并定时刷新，支持 Cmd+U。 */
export function UsagePanel({ provider, sessionId }: { provider: Provider; sessionId?: string }) {
  const locale = useContext(LocaleContext);
  const t = useI18n(),
    [open, setOpen] = useState(false),
    [data, setData] = useState<UsageInfo>(),
    [loading, setLoading] = useState(false);
  useEffect(
    () =>
      window.moose.subscribe((e) => {
        if (e.type === 'command' && e.command === 'usage') setOpen((v) => !v);
      }),
    [],
  );
  useEffect(() => {
    setData(cache.get(provider + ':' + (sessionId || '')));
    if (!open) return;
    let live = true;
    const refresh = async () => {
      setLoading(true);
      try {
        const result = await window.moose.request('usage', { provider, sessionId });
        cache.set(provider + ':' + (sessionId || ''), result);
        if (live) setData(result);
      } catch (error) {
        if (live) setData({ context: null, limits: [], error: String(error) });
      } finally {
        if (live) setLoading(false);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [open, provider, sessionId]);
  const percent = data?.context?.capacity
    ? Math.min(100, (data.context.used / data.context.capacity) * 100)
    : undefined;
  const plan = data?.limits.find((b) => b.plan)?.plan;
  const planLabel = plan === 'prolite' ? 'Pro (5x)' : plan;
  const limits = [...(data?.limits || [])].sort(
    (a, b) => Number(b.name.toLowerCase() === 'codex') - Number(a.name.toLowerCase() === 'codex'),
  );
  /** 将代理返回的秒级时间戳转换为当前语言的本地重置时间。 */
  const resetLabel = (stamp: number) =>
    locale === 'zh-CN'
      ? '将于 ' +
        new Intl.DateTimeFormat('zh-CN', {
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(stamp * 1000)) +
        ' 重置'
      : 'Resets ' +
        new Intl.DateTimeFormat('en', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(stamp * 1000));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        openOnHover
        delay={120}
        closeDelay={180}
        render={
          <Button
            variant="ghost"
            size="icon"
            className="usage-trigger"
            aria-label={t('usage')}
            title="⌘ U"
          />
        }
      >
        <svg className="usage-indicator" viewBox="0 0 20 20" aria-hidden="true">
          <circle
            cx="10"
            cy="10"
            r="7"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            opacity="0.2"
          />
          <circle
            cx="10"
            cy="10"
            r="7"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            pathLength="100"
            strokeDasharray={`${percent ?? 0} 100`}
            transform="rotate(-90 10 10)"
          />
        </svg>
      </PopoverTrigger>
      <PopoverContent className="usage-popup" side="top" align="start" initialFocus={false}>
        <div className="usage-heading">
          <strong>{t('contextWindow')}</strong>
          <span>
            {data?.context
              ? data.context.capacity
                ? `${tokens(data.context.used)} /${tokens(data.context.capacity)} (${Math.round(percent || 0)}%)`
                : String(data.context.used)
              : !sessionId
                ? '0'
                : t('usageUnavailable')}
          </span>
        </div>
        {percent !== undefined && (
          <progress max={100} value={percent} aria-label={t('contextWindow')} />
        )}
        <h3 className="usage-heading">
          <span>{t('planLimits')}</span>
          <span>{planLabel}</span>
        </h3>
        {loading && !data && <p>{t('loading')}</p>}
        {limits.map((bucket, i) => (
          <section key={i}>
            <div className="usage-heading">
              <strong>
                {bucket.name.toLowerCase() === 'codex'
                  ? locale === 'zh-CN'
                    ? '通用'
                    : 'General'
                  : bucket.name}
              </strong>
            </div>
            {bucket.windows.map((w, j) => {
              const remaining = Math.max(0, Math.min(100, 100 - w.usedPercent));
              return (
                <div className="usage-window" key={j}>
                  <div className="usage-heading">
                    <span>
                      {w.minutes === 10080
                        ? locale === 'zh-CN'
                          ? '每周额度'
                          : 'Weekly limit'
                        : w.minutes === 43200
                          ? locale === 'zh-CN'
                            ? '每月额度'
                            : 'Monthly limit'
                          : w.minutes
                            ? `${w.minutes / 60}h limit`
                            : t('planLimits')}
                    </span>
                    <span>
                      {Math.round(remaining)}% {t('remaining')}
                    </span>
                  </div>
                  <progress max={100} value={remaining} aria-label={bucket.name} />
                  {w.resetsAt && <small>{resetLabel(w.resetsAt)}</small>}
                </div>
              );
            })}
          </section>
        ))}
        {data && !data.limits.length && <p>{t('usageUnavailable')}</p>}
        {data?.error && <p className="usage-error">{data.error}</p>}
      </PopoverContent>
    </Popover>
  );
}
