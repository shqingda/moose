import { useState } from 'react';
import type { Fault } from '../../shared/errors';
import { useI18n, type TranslationKey } from '../lib/i18n';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
export function ErrorNotice({
  value,
  onDismiss,
  onReconnect,
  onSettings,
  onBlocker,
}: {
  value: Fault;
  onDismiss?(): void;
  onReconnect(): void;
  onSettings?(): void;
  onBlocker?(): void;
}) {
  const t = useI18n(),
    [copied, setCopied] = useState(false);
  return (
    <Alert variant="destructive" className="experience-error">
      <AlertDescription>
        {t(`error_${value.code.replaceAll('-', '_')}` as TranslationKey)}
      </AlertDescription>
      <div className="flex flex-wrap gap-2">
        {['disconnected', 'uncertain'].includes(value.code) && (
          <Button variant="secondary" size="sm" onClick={onReconnect}>
            {t(value.code === 'uncertain' ? 'checkStatus' : 'reconnectAction')}
          </Button>
        )}
        {['provider', 'auth'].includes(value.code) && onSettings && (
          <Button variant="secondary" size="sm" onClick={onSettings}>
            {t('connectAgent')}
          </Button>
        )}
        {value.code === 'busy' && onBlocker && (
          <Button variant="secondary" size="sm" onClick={onBlocker}>
            {t('viewBlocker')}
          </Button>
        )}
        {onDismiss && (
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            {t('dismiss')}
          </Button>
        )}
      </div>
      <details>
        <summary>{t('errorDetails')}</summary>
        <pre>{value.message}</pre>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void window.moose
              .request('copyText', { text: value.message })
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }
        >
          {t(copied ? 'copied' : 'copyDetails')}
        </Button>
      </details>
    </Alert>
  );
}
