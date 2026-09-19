import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { useEffect, useState } from 'react';
import type { BackgroundScope } from '../../shared/background';
import type { TerminalSession } from '../../shared/terminal';
import { useI18n } from '../lib/i18n';
import { Alert, AlertDescription } from './ui/alert';
import { TerminalView } from './terminal-view';
import { Button } from './ui/button';
import { IconButton } from './common';
import { Plus, X, Terminal } from 'lucide-react';
export function TerminalPanel({
  scope,
  selected,
  onSelect: setSelected,
}: {
  scope: BackgroundScope;
  selected: string;
  onSelect(id: string): void;
}) {
  const t = useI18n(),
    [sessions, setSessions] = useState<TerminalSession[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const session = sessions.find((item) => item.id === selected);
  useEffect(() => {
    let live = true,
      pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const rows = await window.moose.request('terminalList', scope);
        if (live) {
          setSessions(rows);
          if (!rows.some((row) => row.id === selected)) setSelected(rows[0]?.id || '');
        }
      } catch (e) {
        if (live) setError(String(e));
      } finally {
        pending = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 750);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [scope.projectId, scope.sessionId, selected, setSelected]);
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
      setSessions(await window.moose.request('terminalList', scope));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Tabs
      value={selected}
      onValueChange={(value) => setSelected(String(value))}
      className="terminal-panel"
    >
      <div className="terminal-toolbar">
        <div className="terminal-session-tabs">
          <TabsList variant="line" aria-label={t('ptySession')}>
            {sessions.map((row) => (
              <div className="terminal-session-tab" key={row.id}>
                <TabsTrigger value={row.id} title={row.cwd}>
                  <Terminal />
                  <span>{row.title || t('ptyTitle')}</span>
                </TabsTrigger>
                <IconButton
                  label={t('ptyStop')}
                  size="icon-xs"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await window.moose.request('terminalStop', { id: row.id });
                      if (selected === row.id) setSelected('');
                    })
                  }
                >
                  <X />
                </IconButton>
              </div>
            ))}
          </TabsList>
        </div>
        <Button
          aria-label={t('ptyNew')}
          title={t('ptyNew')}
          variant="ghost"
          size={sessions.length ? 'icon' : 'default'}
          className="terminal-new-button"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const next = await window.moose.request('terminalStart', {
                ...scope,
                requestId: crypto.randomUUID(),
                cols: 100,
                rows: 24,
              });
              setSelected(next.id);
            })
          }
        >
          <Plus />
          {!sessions.length && t('ptyNew')}
        </Button>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {session ? (
        <TabsContent value={session.id} className="terminal-session-content">
          <TerminalView key={session.id} session={session} onError={setError} />
        </TabsContent>
      ) : (
        <p className="extension-note">{t('ptyEmpty')}</p>
      )}
    </Tabs>
  );
}
