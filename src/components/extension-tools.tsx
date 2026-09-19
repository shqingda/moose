import { McpRegistrationForm } from './mcp-registration-form';
import { useEffect, useState } from 'react';
import { Puzzle } from 'lucide-react';
import type {
  ExtensionScope,
  ExtensionSnapshot,
  ExtensionChange,
  ExtensionAuth,
} from '../../shared/extensions';
import { useI18n } from '../lib/i18n';
import { IconButton } from './common';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogDescription } from './ui/dialog';
export function ExtensionTools({ scope }: { scope: ExtensionScope }) {
  const t = useI18n(),
    [open, setOpen] = useState(false),
    [snapshot, setSnapshot] = useState<ExtensionSnapshot>(),
    [sourceId, setSourceId] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [change, setChange] = useState<ExtensionChange>(),
    [model, setModel] = useState(''),
    [auth, setAuth] = useState<ExtensionAuth>(),
    [search, setSearch] = useState('');
  const source = snapshot?.sources.find((s) => s.id === sourceId && s.writable);
  async function load() {
    setChange(undefined);
    setBusy(true);
    setError('');
    try {
      const next = await window.moose.request('extensionsRead', scope);
      setSnapshot(next);
      setSourceId(next.sources.find((s) => s.writable)?.id || '');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (open) void load();
  }, [open, scope.projectId, scope.sessionId, scope.provider]);
  useEffect(() => {
    if (auth?.status !== 'pending') return;
    let live = true;
    const timer = setInterval(() => {
      void window.moose
        .request('extensionsAuth', { id: auth.id })
        .then((state) => {
          if (live) {
            setAuth(state);
            if (state.status === 'completed') void load();
          }
        })
        .catch((e) => {
          if (live) {
            setError(String(e));
            setAuth(undefined);
          }
        });
    }, 1000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [auth?.id, auth?.status]);
  function toggle(category: 'mcp' | 'plugin', name: string, enabled: boolean) {
    if (source)
      setChange({
        type: 'toggle',
        sourceId: source.id,
        version: source.version,
        category,
        name,
        enabled,
      });
  }
  async function save() {
    if (!change) return;
    setBusy(true);
    setError('');
    try {
      setSnapshot(
        await window.moose.request('extensionsChange', {
          ...scope,
          change,
          requestId: crypto.randomUUID(),
        }),
      );
      setChange(undefined);
    } catch (e) {
      setError(String(e));
      setChange(undefined);
    } finally {
      setBusy(false);
    }
  }
  async function login(name: string) {
    setBusy(true);
    setError('');
    try {
      const next = await window.moose.request('extensionsLogin', {
        ...scope,
        name,
        requestId: crypto.randomUUID(),
      });
      setAuth(next);
      try {
        await window.moose.request('openExternal', { url: next.url });
      } catch (e) {
        setAuth(await window.moose.request('extensionsAuth', { id: next.id, cancel: true }));
        throw e;
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <IconButton label={t('extTitle')} onClick={() => setOpen(true)}>
        <Puzzle />
      </IconButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="native-dialog">
          <DialogHeader>
            <DialogTitle>{t('extTitle')}</DialogTitle>
            <DialogDescription>{t('extHint')}</DialogDescription>
          </DialogHeader>
          <div className="native-dialog-body space-y-3">
            <div className="flex items-center justify-between">
              <span>
                {scope.provider} · {snapshot?.version}
              </span>
              <Button variant="outline" disabled={busy} onClick={load}>
                {t('refresh')}
              </Button>
            </div>
            {error && (
              <p role="alert" className="text-destructive break-words">
                {error}
              </p>
            )}
            {busy && <p>{t('loading')}</p>}
            {snapshot?.reason && <p>{snapshot.reason}</p>}
            {snapshot?.supported && (
              <>
                <h3>{t('extSources')}</h3>
                <p className="text-xs break-all">{snapshot.cwd}</p>
                {snapshot.sources.map((s) => (
                  <div key={s.id} className="rounded-lg border p-2">
                    <p>
                      {s.kind} ·{' '}
                      {s.disabled
                        ? t('extDisabled')
                        : s.writable
                          ? t('extWritable')
                          : t('extReadOnly')}
                    </p>
                    <p className="text-xs break-all">{s.path}</p>
                    {s.writable && (
                      <Button
                        variant={s.id === sourceId ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => {
                          setSourceId(s.id);
                          setChange(undefined);
                        }}
                      >
                        {t('extChoose')}
                      </Button>
                    )}
                  </div>
                ))}
                <h3>{t('extSettings')}</h3>
                {snapshot.settings.map((s) => (
                  <p key={s.key} className="text-sm">
                    {s.key}: {s.value}{' '}
                    <small>{snapshot.sources.find((layer) => layer.id === s.source)?.path}</small>
                  </p>
                ))}
                <div className="flex gap-2">
                  <Input
                    aria-label={t('extModel')}
                    placeholder={t('extModel')}
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  />
                  <Button
                    disabled={busy || !source || !model.trim()}
                    onClick={() => {
                      if (source)
                        setChange({
                          type: 'config',
                          sourceId: source.id,
                          version: source.version,
                          key: 'model',
                          value: model.trim(),
                        });
                    }}
                  >
                    {t('extPrepare')}
                  </Button>
                </div>
                <h3>MCP</h3>
                <McpRegistrationForm source={source} disabled={busy} onPreview={setChange} />
                {snapshot.mcp.map((s) => (
                  <div key={s.name} className="rounded-lg border p-2">
                    <p>
                      {s.name} · {s.auth} · {s.tools} tools {s.failed ? '⚠' : ''}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || !source}
                        onClick={() => toggle('mcp', s.name, !s.enabled)}
                      >
                        {t(s.enabled ? 'extDisable' : 'extEnable')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || !s.enabled || auth?.status === 'pending'}
                        onClick={() => login(s.name)}
                      >
                        {t('extLogin')}
                      </Button>
                    </div>
                  </div>
                ))}
                {auth && (
                  <div role="status">
                    {auth.name}: {auth.status}
                    {auth.status === 'pending' && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          void window.moose
                            .request('extensionsAuth', { id: auth.id, cancel: true })
                            .then(setAuth)
                            .catch((e) => setError(String(e)));
                        }}
                      >
                        {t('cancel')}
                      </Button>
                    )}
                  </div>
                )}
                <h3>{t('extPlugins')}</h3>
                <p className="text-xs">{t('extPluginScope')}</p>
                <Input
                  aria-label={t('extSearch')}
                  placeholder={t('extSearch')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {snapshot.plugins
                  .filter((p) =>
                    search ? p.id.toLowerCase().includes(search.toLowerCase()) : p.installed,
                  )
                  .slice(0, 100)
                  .map((p) => (
                    <div key={p.id} className="rounded-lg border p-2">
                      <p>
                        {p.name} · {p.marketplace}
                      </p>
                      <div className="flex gap-2">
                        {p.installed && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy || !source}
                            onClick={() => toggle('plugin', p.id, !p.enabled)}
                          >
                            {t(p.enabled ? 'extDisable' : 'extEnable')}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || (p.installed ? !p.removable : !p.installable)}
                          onClick={() =>
                            setChange({
                              type: 'plugin',
                              id: p.id,
                              action: p.installed ? 'uninstall' : 'install',
                            })
                          }
                        >
                          {t(p.installed ? 'extUninstall' : 'extInstall')}
                        </Button>
                      </div>
                    </div>
                  ))}
                <h3>Hooks</h3>
                <p className="text-xs">{t('extHooksHint')}</p>
                {snapshot.hooks.map((h) => (
                  <div key={h.key} className="rounded-lg border p-2">
                    <p>
                      {h.event} · {h.handler} · {t(h.enabled ? 'extEnabled' : 'extDisabled')}
                    </p>
                    <p className="text-xs break-all">{h.source}</p>
                  </div>
                ))}
                {snapshot.diagnostics.map((d, i) => (
                  <p key={i} role="alert" className="text-sm break-all">
                    {d.area}: {d.path} {d.message}
                  </p>
                ))}
                {change && (
                  <div className="rounded-lg border p-3 space-y-2">
                    <h3>{t('extConfirm')}</h3>
                    <p className="text-xs break-all">
                      {change.type === 'plugin' ? t('extPluginScope') : source?.path}
                    </p>
                    <pre className="whitespace-pre-wrap break-all text-xs">
                      {JSON.stringify(
                        change.type === 'mcpAdd'
                          ? { name: change.name, server: change.server, enabled: false }
                          : change.type === 'config'
                            ? { key: change.key, value: change.value }
                            : change.type === 'toggle'
                              ? {
                                  category: change.category,
                                  name: change.name,
                                  enabled: change.enabled,
                                }
                              : { id: change.id, action: change.action },
                        null,
                        2,
                      )}
                    </pre>
                    <Button disabled={busy} onClick={save}>
                      {t('extApply')}
                    </Button>
                    <Button variant="ghost" disabled={busy} onClick={() => setChange(undefined)}>
                      {t('cancel')}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
