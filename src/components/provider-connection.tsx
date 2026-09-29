import { useEffect, useState } from 'react';
import { providerDefinitions } from '../../shared/providers';
import type { Provider, ProviderInfo, Settings } from '../../shared/types';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Switch } from './ui/switch';
import { Field, FieldLabel } from './ui/field';
const guides = {
  codex: { url: 'https://developers.openai.com/codex/cli/', command: 'codex login' },
  grok: { url: 'https://docs.x.ai/build', command: 'grok' },
  pi: {
    url: 'https://github.com/earendil-works/pi/tree/main/packages/coding-agent',
    command: 'pi',
  },
  opencode: { url: 'https://opencode.ai/v2/docs', command: 'opencode auth login' },
};
export function ProviderConnection({
  provider,
  initiallyExpanded,
  info,
  settings,
  checking,
  onSave,
  onReconnect,
  onError,
}: {
  initiallyExpanded?: boolean;
  provider: Provider;
  info?: ProviderInfo;
  settings: Settings;
  checking: boolean;
  onSave(settings: Partial<Settings>): Promise<unknown>;
  onReconnect(): Promise<unknown>;
  onError(error: unknown): void;
}) {
  const t = useI18n(),
    key = providerDefinitions[provider].pathKey,
    enabledKey = providerDefinitions[provider].enabledKey;
  const [expanded, setExpanded] = useState(false),
    [value, setValue] = useState(settings[key]),
    [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed' | 'invalid'>('idle'),
    [dirty, setDirty] = useState(false),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!dirty) setValue(settings[key]);
  }, [settings[key], dirty]);
  const status = !settings[enabledKey]
    ? 'disabled'
    : !info?.available
      ? 'missing'
      : info.connected
        ? 'ready'
        : info.failure?.code === 'auth'
          ? 'auth'
          : 'failed';
  useEffect(() => {
    if (initiallyExpanded) setExpanded(true);
  }, [initiallyExpanded]);
  async function save() {
    if (state === 'saving' || !dirty) return;
    const path = value.trim();
    if (path && !path.startsWith('/')) {
      setState('invalid');
      return;
    }
    setState('saving');
    try {
      await onSave({ [key]: path });
      setValue(path);
      setDirty(false);
      setState('saved');
    } catch (error) {
      setState('failed');
      onError(error);
      return;
    }
    await onReconnect().catch(onError);
  }
  return (
    <section className="provider-card">
      <div className="provider-summary">
        <button
          className="provider-row"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <span>
            <strong>
              {t(provider)} <small>{info?.version}</small>
            </strong>
            <span className="provider-path">
              {checking
                ? t('checking')
                : `${t(`provider_${status}`)}${status === 'ready' ? ` · ${info?.models.length || 0} ${t('model')}` : ''}`}
            </span>
          </span>
        </button>
        {info?.available && (
          <Switch
            aria-label={`${t('enableProvider')} ${t(provider)}`}
            checked={settings[enabledKey]}
            disabled={checking}
            onCheckedChange={(enabled) =>
              void onSave({ [enabledKey]: enabled })
                .then(onReconnect)
                .catch((error) => onError(error))
            }
          />
        )}
      </div>
      {expanded && (
        <div className="provider-details">
          <p className="extension-note">
            {t('setupHint')}
            {provider === 'pi' && ' · pi → /login'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void window.moose
                  .request('openExternal', { url: guides[provider].url })
                  .catch((error) => onError(error))
              }
            >
              {t('setupDocs')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void window.moose
                  .request('copyText', { text: guides[provider].command })
                  .then(() => setCopied(true))
                  .catch((error) => onError(error))
              }
            >
              {t(copied ? 'copied' : 'setupCommand')}
            </Button>
          </div>
          {info?.path && <code className="provider-resolved-path">{info.path}</code>}
          <Field>
            <FieldLabel htmlFor={key}>{t('cliPath')}</FieldLabel>
            <Input
              id={key}
              value={value}
              disabled={state === 'saving'}
              placeholder={t('autoDetect')}
              aria-invalid={state === 'invalid'}
              onChange={(e) => {
                setValue(e.target.value);
                setDirty(true);
                setState('idle');
              }}
              onBlur={() => void save()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void save();
                }
              }}
            />
            {state !== 'idle' && (
              <p role="status">
                {t(
                  state === 'invalid'
                    ? 'pathInvalid'
                    : state === 'failed'
                      ? 'saveFailed'
                      : state === 'saving'
                        ? 'saving'
                        : 'saved',
                )}
              </p>
            )}
            {info?.error && (
              <details>
                <summary>{t('errorDetails')}</summary>
                <pre>{info.error}</pre>
              </details>
            )}
          </Field>
        </div>
      )}
    </section>
  );
}
