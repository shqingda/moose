import type { NativeEntry } from '../../shared/native-sessions';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';

/** 历史预览只渲染记录，不把旧审批或工具调用恢复成可执行控件。 */
export function NativePreview({
  items,
  more,
  busy,
  load,
}: {
  items: NativeEntry[];
  more: boolean;
  busy: boolean;
  load(): void;
}) {
  const t = useI18n();
  return (
    <div className="native-history-entries">
      {items.map((item, index) => (
        <article key={`${item.id}:${index}`} className="rounded-lg border p-3">
          <small className="text-muted-foreground">
            {t(
              item.kind === 'user'
                ? 'nativeUser'
                : item.kind === 'assistant'
                  ? 'nativeAssistant'
                  : item.kind === 'reasoning'
                    ? 'reasoning'
                    : item.kind === 'tool'
                      ? 'tool'
                      : 'nativeRecord',
            )}
            {item.title ? ` · ${item.title}` : ''}
          </small>
          <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm">{item.text}</pre>
        </article>
      ))}
      {!items.length && !busy && <p>{t('noResults')}</p>}
      {more && (
        <Button variant="outline" disabled={busy} onClick={load}>
          {t('nativeMore')}
        </Button>
      )}
    </div>
  );
}
