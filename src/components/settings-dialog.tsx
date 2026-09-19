import { providerDefinitions, providerIds } from '../../shared/providers';
import { useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  ExternalLink,
  Monitor,
  Terminal,
  Keyboard,
  Plug,
  RefreshCw,
} from 'lucide-react';
import type { ProviderInfo, Settings } from '../../shared/types';
import { useI18n } from '../lib/i18n';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Field, FieldGroup, FieldLabel, FieldDescription } from './ui/field';
import { Switch } from './ui/switch';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Picker } from './common';
/** 组织通用、服务商与配置指南页面，配置保存和重新连接由父组件处理。 */
export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  providers,
  checking,
  onSave,
  onReconnect,
  onError,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  settings: Settings;
  providers: ProviderInfo[];
  checking: boolean;
  onSave(settings: Partial<Settings>): Promise<unknown>;
  onReconnect(): Promise<unknown>;
  onError(error: string): void;
}) {
  const t = useI18n(),
    [page, setPage] = useState<'general' | 'providers' | 'guide'>('general'),
    [expanded, setExpanded] = useState('');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="settings-dialog settings-page" showCloseButton={false}>
        <nav className="settings-nav" aria-label={t('settings')}>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            <ArrowLeft />
            {t('back')}
          </Button>
          <div className="settings-navigation">
            {(
              [
                { id: 'general', label: 'generalPage', Icon: Monitor },
                { id: 'providers', label: 'providersPage', Icon: Plug },
                { id: 'guide', label: 'documentation', Icon: BookOpen },
              ] as const
            ).map(({ id, label, Icon }) => (
              <Button
                key={id}
                variant={page === id ? 'secondary' : 'ghost'}
                aria-current={page === id ? 'page' : undefined}
                onClick={() => setPage(id)}
              >
                <Icon />
                {t(label)}
              </Button>
            ))}
          </div>
        </nav>
        <div className="settings-body">
          <DialogHeader>
            <DialogTitle>
              {t(
                page === 'general'
                  ? 'generalPage'
                  : page === 'providers'
                    ? 'providersPage'
                    : 'documentation',
              )}
            </DialogTitle>
          </DialogHeader>
          {page === 'general' && (
            <section className="settings-section">
              <FieldGroup>
                <Field orientation="horizontal">
                  <FieldLabel>{t('theme')}</FieldLabel>
                  <Picker
                    label={t('theme')}
                    value={settings.theme}
                    options={(['system', 'light', 'dark'] as const).map((value) => ({
                      value,
                      label: t(value),
                    }))}
                    onChange={(theme) => {
                      void onSave({ theme: theme as Settings['theme'] });
                    }}
                  />
                </Field>
                <Field orientation="horizontal">
                  <FieldLabel>{t('language')}</FieldLabel>
                  <Picker
                    label={t('language')}
                    value={settings.language}
                    options={[
                      { value: 'system', label: t('system') },
                      { value: 'en', label: 'English' },
                      { value: 'zh-CN', label: '简体中文' },
                    ]}
                    onChange={(language) => {
                      void onSave({ language: language as Settings['language'] });
                    }}
                  />
                </Field>
                <Field orientation="horizontal">
                  <FieldLabel>{t('textSize')}</FieldLabel>
                  <Picker
                    label={t('textSize')}
                    value={String(settings.fontScale)}
                    options={[0.9, 1, 1.1, 1.2, 1.3].map((value) => ({
                      value: String(value),
                      label: `${Math.round(value * 100)}%`,
                    }))}
                    onChange={(value) => {
                      void onSave({ fontScale: Number(value) });
                    }}
                  />
                </Field>
              </FieldGroup>
            </section>
          )}
          {page === 'general' && (
            <section className="settings-section shortcut-section">
              <h3>
                <Keyboard size={18} />
                {t('shortcuts')}
              </h3>
              {(
                [
                  ['addProject', '⌘ O'],
                  ['newSession', '⌘ N'],
                  ['search', '⌘ K'],
                  ['toggleSidebar', '⌘ B'],
                  ['review', '⇧ ⌘ B'],
                  ['usage', '⌘ U'],
                  ['ptyTitle', '⌃ `'],
                  ['ptyNew', '⌃ ⇧ `'],
                  ['bgCommand', '⇧ ⌘ J'],
                  ['bgSchedules', '⇧ ⌘ S'],
                  ['focusComposer', '⌘ L'],
                  ['settings', '⌘ ,'],
                ] as const
              ).map(([label, keys]) => (
                <div className="shortcut-row" key={label}>
                  <span>{t(label)}</span>
                  <kbd>{keys}</kbd>
                </div>
              ))}
            </section>
          )}
          {page === 'providers' && (
            <section className="settings-section">
              <div className="provider-page-heading">
                <div>
                  <h3>{t('connections')}</h3>
                  <p className="provider-intro">{t('providerIntro')}</p>
                </div>
                <Button
                  variant="outline"
                  disabled={checking}
                  onClick={() => {
                    void onReconnect();
                  }}
                >
                  <RefreshCw />
                  {t('refresh')}
                </Button>
              </div>
              {providerIds.map((provider) => {
                const info = providers.find((p) => p.provider === provider),
                  key = providerDefinitions[provider].pathKey;
                return (
                  <section className="provider-card" key={provider}>
                    <div className="provider-summary">
                      <button
                        className="provider-row"
                        aria-expanded={expanded === provider}
                        onClick={() => setExpanded(expanded === provider ? '' : provider)}
                      >
                        <span className="provider-symbol">
                          <Terminal size={22} />
                          <span
                            className={`connection-dot ${info?.connected ? 'connected' : ''}`}
                          />
                        </span>
                        <span>
                          <strong>
                            {t(provider)} <small>{info?.version}</small>
                          </strong>
                          <span className="provider-path">
                            {checking
                              ? t('checking')
                              : info?.path || `${t('notInPath')} ${provider}`}
                            {!checking &&
                              info?.connected &&
                              ` · ${info.models.length} ${t('model')}`}
                          </span>
                        </span>
                        <ChevronRight className="provider-chevron" size={16} />
                      </button>
                      {info?.available && (
                        <Switch
                          aria-label={`${t('enableProvider')} ${t(provider)}`}
                          checked={settings[providerDefinitions[provider].enabledKey]}
                          disabled={checking}
                          onCheckedChange={(enabled) => {
                            void onSave({
                              [providerDefinitions[provider].enabledKey]: enabled,
                            })
                              .then(onReconnect)
                              .catch((error) => onError(String(error)));
                          }}
                        />
                      )}
                    </div>
                    {expanded === provider && (
                      <FieldGroup className="provider-details">
                        <Field>
                          <FieldLabel htmlFor={key}>{t('cliPath')}</FieldLabel>
                          <Input
                            id={key}
                            defaultValue={settings[key]}
                            placeholder={t('autoDetect')}
                            onBlur={(e) => {
                              const value = e.currentTarget.value.trim();
                              e.currentTarget.value = value;
                              if (value === settings[key]) return;
                              void onSave({ [key]: value })
                                .then(onReconnect)
                                .catch((error) => onError(String(error)));
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                                e.preventDefault();
                                e.currentTarget.blur();
                              }
                            }}
                          />
                          {info?.error && (info.available || settings[key]) && (
                            <FieldDescription>{info.error}</FieldDescription>
                          )}
                        </Field>
                      </FieldGroup>
                    )}
                  </section>
                );
              })}
            </section>
          )}
          {page === 'guide' && (
            <section className="setup-guide">
              <p>{t('guideIntro')}</p>
              {providerIds.map((provider) => (
                <section key={provider}>
                  <h3>{t(provider)}</h3>
                  <pre>{providerDefinitions[provider].guide}</pre>
                  <Button
                    variant="outline"
                    onClick={() => {
                      void window.moose
                        .request('openExternal', {
                          url: providerDefinitions[provider].url,
                        })
                        .catch((error) => onError(String(error)));
                    }}
                  >
                    {t('documentation')}
                    <ExternalLink />
                  </Button>
                </section>
              ))}
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
