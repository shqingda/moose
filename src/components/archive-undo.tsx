import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { useI18n } from '../lib/i18n';
export function ArchiveUndo({
  onUndo,
  onClose,
  onError,
}: {
  onUndo(): Promise<void>;
  onClose(): void;
  onError(error: unknown): void;
}) {
  const t = useI18n(),
    [hover, setHover] = useState(false),
    [focus, setFocus] = useState(false),
    [busy, setBusy] = useState(false);
  const remaining = useRef(10000),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (hover || focus || busy) return;
    const start = Date.now();
    const timer = setTimeout(() => close.current(), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - start));
    };
  }, [hover, focus, busy]);
  return (
    <div
      className="archive-undo"
      role="status"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocus(false);
      }}
    >
      <span>{t('archived')}</span>
      <Button
        size="sm"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void onUndo()
            .then(onClose)
            .catch(onError)
            .finally(() => setBusy(false));
        }}
      >
        {t('undo')}
      </Button>
      <Button variant="ghost" size="sm" onClick={onClose}>
        {t('dismiss')}
      </Button>
    </div>
  );
}
