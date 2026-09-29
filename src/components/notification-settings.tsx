import { useEffect, useState } from 'react';
import type { Settings } from '../../shared/types';
import { useI18n } from '../lib/i18n';
import { Switch } from './ui/switch';
import { Field, FieldLabel } from './ui/field';
export function NotificationSettings({
  settings,
  onSave,
  onError,
}: {
  settings: Settings;
  onSave(patch: Partial<Settings>): Promise<unknown>;
  onError(error: unknown): void;
}) {
  const t = useI18n(),
    [permission, setPermission] = useState('default'),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const refresh = () =>
      void window.moose
        .request('notificationPermission', {})
        .then((value) => {
          if (live) setPermission(value);
        })
        .catch((error) => {
          if (live) onError(error);
        });
    refresh();
    window.addEventListener('focus', refresh);
    const stop = window.moose.subscribe((e) => {
      if (e.type === 'notification-unavailable') refresh();
    });
    return () => {
      live = false;
      window.removeEventListener('focus', refresh);
      stop();
    };
  }, []);
  async function toggle(key: 'notifyAttention' | 'notifyResults', value: boolean) {
    setBusy(true);
    try {
      if (value) {
        const next = await window.moose.request('notificationPermission', { request: true });
        setPermission(next);
        if (next === 'denied' || next === 'unsupported' || next === 'default') return;
      }
      await onSave({ [key]: value });
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-section">
      <h3>{t('notifications')}</h3>
      <p className="extension-note">{t('notificationHint')}</p>
      {(['notifyAttention', 'notifyResults'] as const).map((key) => (
        <Field key={key} orientation="horizontal">
          <FieldLabel htmlFor={key}>{t(key)}</FieldLabel>
          <Switch
            id={key}
            checked={settings[key]}
            disabled={busy}
            onCheckedChange={(value) => void toggle(key, value)}
          />
        </Field>
      ))}
      {window.moose.host !== 'web' && permission === 'default' && (
        <p className="extension-note">{t('notificationNative')}</p>
      )}
      {permission === 'denied' && <p role="status">{t('notificationDenied')}</p>}
      {permission === 'unsupported' && <p role="status">{t('notificationUnsupported')}</p>}
    </section>
  );
}
