import { IconButton } from './common';
import { RefreshCw } from 'lucide-react';

import { ExtensionConfirm } from './extension-confirm';
import { McpRegistrationForm } from './mcp-registration-form';
import { useEffect, useRef, useState } from 'react';
import type {
  ExtensionScope,
  ExtensionSnapshot,
  ExtensionChange,
  ExtensionAuth,
} from '../../shared/extensions';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Badge } from './ui/badge';
import { Empty, EmptyHeader, EmptyTitle } from './ui/empty';
export function ExtensionTools({ scope }: { scope: ExtensionScope }) {
  const t = useI18n(),
    [snapshot, setSnapshot] = useState<ExtensionSnapshot>(),
    [sourceId, setSourceId] = useState(''),
    [busy, setBusy] = useState(false),
    [pendingToggle, setPendingToggle] = useState(''),
    [formRevision, setFormRevision] = useState(0),
    [error, setError] = useState(''),
    [change, setChange] = useState<ExtensionChange>(),
    [model, setModel] = useState(''),
    [auth, setAuth] = useState<ExtensionAuth>(),
    [authURL, setAuthURL] = useState(''),
    [search, setSearch] = useState(''),
    [editing, setEditing] = useState<{ name: string; transport: 'http' | 'stdio' }>();
  const operation = useRef(false);
  const capabilities = snapshot?.capabilities;
  const source = snapshot?.sources.find((s) => s.id === sourceId && s.writable);
  const servers = [...(snapshot?.mcp || [])].sort((a, b) =>
    a.name.localeCompare(b.name, 'en', { numeric: true }),
  );
  const plugins =
    snapshot?.plugins
      .filter((p) => (search ? p.id.toLowerCase().includes(search.toLowerCase()) : p.installed))
      .slice(0, 100) || [];
  async function load() {
    if (operation.current) return;
    operation.current = true;
    setChange(undefined);
    setEditing(undefined);
    setBusy(true);
    setError('');
    try {
      const next = await window.moose.request('extensionsRead', scope);
      setSnapshot(next);
      setSourceId(next.sources.find((s) => s.writable)?.id || '');
    } catch (e) {
      setError(String(e));
    } finally {
      operation.current = false;
      setPendingToggle('');
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, [scope.projectId, scope.sessionId, scope.provider]);
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
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && !busy && !change && !editing && !model.trim())
        void load();
    };
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 30000);
    return () => {
      window.removeEventListener('focus', refresh);
      window.clearInterval(timer);
    };
  }, [busy, change, editing, model]);
  function toggle(category: 'mcp' | 'plugin', name: string, enabled: boolean) {
    if (source)
      void save({
        type: 'toggle',
        sourceId: source.id,
        version: source.version,
        category,
        name,
        enabled,
      });
  }
  async function save(next = change) {
    if (!next || operation.current) return;
    operation.current = true;
    setPendingToggle(next.type === 'toggle' ? `${next.category}:${next.name}` : '');
    setBusy(true);
    setError('');
    try {
      const updated = await window.moose.request('extensionsChange', {
        ...scope,
        change: next,
        requestId: crypto.randomUUID(),
      });
      setSnapshot((previous) =>
        updated.configurationOnly && previous
          ? {
              ...updated,
              plugins: previous.plugins,
              hooks: previous.hooks,
              mcp: updated.mcp.map((server) => {
                const old = previous.mcp.find((entry) => entry.name === server.name);
                return old
                  ? { ...old, ...server, auth: old.auth, tools: old.tools, failed: old.failed }
                  : server;
              }),
            }
          : updated,
      );
      setChange(undefined);
      if (next.type === 'mcpAdd' || next.type === 'mcpEdit') {
        setEditing(undefined);
        setFormRevision((revision) => revision + 1);
      }
      if (next.type === 'config') setModel('');
    } catch (e) {
      setError(String(e));
      setChange(undefined);
    } finally {
      operation.current = false;
      setPendingToggle('');
      setBusy(false);
    }
  }
  async function login(name: string) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError('');
    try {
      const next = await window.moose.request('extensionsLogin', {
        ...scope,
        name,
        requestId: crypto.randomUUID(),
      });
      setAuthURL(next.url);
      setAuth(next);
      try {
        if (window.moose.host !== 'web')
          await window.moose.request('openExternal', { url: next.url });
      } catch (e) {
        setAuth(await window.moose.request('extensionsAuth', { id: next.id, cancel: true }));
        throw e;
      }
    } catch (e) {
      setError(String(e));
    } finally {
      operation.current = false;
      setPendingToggle('');
      setBusy(false);
    }
  }
  return (
    <>
      <div className="extension-content settings-extensions" data-toggling={!!pendingToggle}>
        <div className="flex items-center justify-between">
          <span className="extension-version">
            {snapshot?.version?.match(/\d+\.\d+\.\d+/)?.[0]
              ? `${t(scope.provider)} ${snapshot.version.match(/\d+\.\d+\.\d+/)![0]}`
              : ''}
          </span>
          <IconButton label={t('refresh')} disabled={busy} data-busy-lock onClick={load}>
            <RefreshCw />
          </IconButton>
        </div>
        {error && (
          <p role="alert" className="text-destructive break-words">
            {error}
          </p>
        )}
        {busy && !snapshot && <p>{t('loading')}</p>}
        {snapshot?.supported === false && <p className="extension-note">{t('extUnsupported')}</p>}
        {snapshot?.supported && (
          <>
            <Tabs
              defaultValue={capabilities?.mcp === false ? 'agent' : 'mcp'}
              className="extension-tabs"
            >
              <TabsList aria-label={t('extTitle')}>
                {capabilities?.mcp !== false && <TabsTrigger value="mcp">MCP</TabsTrigger>}
                <TabsTrigger value="plugins">{t('extPlugins')}</TabsTrigger>
                <TabsTrigger value="agent">{t('extOverview')}</TabsTrigger>
                {capabilities?.diagnostics !== false && (
                  <TabsTrigger value="diagnostics">
                    {t('extDiagnostics')}
                    {!!snapshot.diagnostics.length && (
                      <Badge variant="secondary">{snapshot.diagnostics.length}</Badge>
                    )}
                  </TabsTrigger>
                )}
              </TabsList>
              <TabsContent value="agent" className="extension-section">
                <details className="extension-details extension-sources">
                  <summary>{t('extSources')}</summary>
                  {snapshot.sources.map((s) => (
                    <div key={s.id} className="extension-source-row">
                      <p>
                        {t(
                          s.kind === 'user'
                            ? 'extUserSource'
                            : s.kind === 'system'
                              ? 'extSystemSource'
                              : 'extSources',
                        )}{' '}
                        ·{' '}
                        {s.disabled
                          ? t('extDisabled')
                          : s.writable
                            ? t('extWritable')
                            : t('extReadOnly')}
                      </p>
                      <p className="text-xs break-all">{s.path}</p>
                    </div>
                  ))}
                </details>
                <h3>{t('extSettings')}</h3>
                {snapshot.settings.map((s) => (
                  <p key={s.key} className="text-sm">
                    {s.key}: {s.value}
                  </p>
                ))}
                {capabilities?.model !== false && (
                  <div className="flex gap-2">
                    <Input
                      aria-label={t('extModel')}
                      placeholder={t('extModel')}
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                    />
                    <Button
                      data-busy-lock={!!source && !!model.trim()}
                      disabled={busy || !source || !model.trim()}
                      onClick={() => {
                        if (source)
                          void save({
                            type: 'config',
                            sourceId: source.id,
                            version: source.version,
                            key: 'model',
                            value: model.trim(),
                          });
                      }}
                    >
                      {t('save')}
                    </Button>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="mcp" className="extension-section">
                {capabilities?.mcpEdit !== false && (
                  <McpRegistrationForm
                    key={`${editing?.name || 'new'}:${formRevision}`}
                    editing={editing}
                    onCancel={() => {
                      setEditing(undefined);
                      setChange(undefined);
                    }}
                    source={source}
                    disabled={busy && !pendingToggle}
                    onPreview={(next) => {
                      if (!operation.current) setChange(next);
                    }}
                  />
                )}

                {!snapshot.mcp.length && (
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>{t('extEmpty')}</EmptyTitle>
                    </EmptyHeader>
                  </Empty>
                )}
                {servers.map((s) => (
                  <div key={s.name} className="extension-row">
                    <div className="extension-row-heading">
                      <strong>{s.name}</strong>
                      <Badge variant={s.failed ? 'destructive' : 'secondary'}>
                        {t(s.enabled ? 'extEnabled' : 'extDisabled')}
                      </Badge>
                    </div>
                    {!capabilities && (
                      <p className="extension-note">
                        {t(
                          s.auth === 'notLoggedIn'
                            ? 'mcpUnauthenticated'
                            : s.auth === 'oAuth'
                              ? 'mcpAuthenticated'
                              : 'mcpAvailable',
                        )}{' '}
                        · {s.tools} {t('mcpTools')}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        data-busy-lock={!!source}
                        disabled={busy || !source}
                        data-pending={pendingToggle === `mcp:${s.name}`}
                        onClick={() => toggle('mcp', s.name, !s.enabled)}
                      >
                        {t(s.enabled ? 'extDisable' : 'extEnable')}
                      </Button>
                      {capabilities?.auth !== false && (
                        <Button
                          size="sm"
                          variant="outline"
                          data-busy-lock={s.enabled && auth?.status !== 'pending'}
                          disabled={busy || !s.enabled || auth?.status === 'pending'}
                          onClick={() => login(s.name)}
                        >
                          {t('extLogin')}
                        </Button>
                      )}
                      {capabilities?.mcpEdit !== false && source && s.sourceId === source.id && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            data-busy-lock={!!s.transport}
                            disabled={busy || !s.transport}
                            onClick={() => {
                              setChange(undefined);
                              setEditing({ name: s.name, transport: s.transport! });
                            }}
                          >
                            {t('mcpEdit')}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {auth && (
                  <div role="status">
                    {auth.name}: {auth.status}
                    {auth.status === 'pending' &&
                      window.moose.host === 'web' &&
                      /^https?:\/\//i.test(authURL) && (
                        <a href={authURL} target="_blank" rel="noopener noreferrer">
                          {t('extLogin')}
                        </a>
                      )}
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
              </TabsContent>
              <TabsContent value="plugins" className="extension-section">
                <Input
                  aria-label={t('extSearch')}
                  placeholder={t(capabilities?.pluginInstall ? 'extPackage' : 'extSearch')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {capabilities?.pluginInstall &&
                  search.trim() &&
                  !snapshot.plugins.some((p) => p.id === search.trim()) && (
                    <Button
                      data-busy-lock
                      disabled={busy}
                      onClick={() =>
                        setChange({ type: 'plugin', id: search.trim(), action: 'install' })
                      }
                    >
                      {t('extInstall')}
                    </Button>
                  )}
                {!plugins.length && (
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>{t(search ? 'extEmpty' : 'extDiscover')}</EmptyTitle>
                    </EmptyHeader>
                  </Empty>
                )}
                {plugins.map((p) => (
                  <div key={p.id} className="extension-row">
                    <p>
                      {p.name}
                      {p.marketplace && ` · ${p.marketplace}`}
                    </p>
                    <div className="flex gap-2">
                      {p.installed && capabilities?.pluginToggle !== false && (
                        <Button
                          size="sm"
                          variant="outline"
                          data-busy-lock={!!source}
                          disabled={busy || !source}
                          data-pending={pendingToggle === `plugin:${p.id}`}
                          onClick={() => toggle('plugin', p.id, !p.enabled)}
                        >
                          {t(p.enabled ? 'extDisable' : 'extEnable')}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        data-busy-lock={p.installed ? p.removable : p.installable}
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
              </TabsContent>
              <TabsContent value="diagnostics" className="extension-section">
                <h3>Hooks</h3>
                <p className="text-xs">{t('extHooksHint')}</p>
                {snapshot.hooks.map((h) => (
                  <div key={h.key} className="extension-row">
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
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

      <ExtensionConfirm
        change={change}
        path={source?.path}
        busy={busy}
        onSave={() => void save()}
        onCancel={() => setChange(undefined)}
      />
    </>
  );
}
