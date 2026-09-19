import { useEffect, useState } from 'react';
import type { BackgroundScope } from '../../shared/background';
import type { TerminalSession } from '../../shared/terminal';
import { useI18n } from '../lib/i18n';
import { Alert, AlertDescription } from './ui/alert';
import { TerminalView } from './terminal-view';
import { Picker, IconButton } from './common';
import { Plus, Square } from 'lucide-react';
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
          if (!selected && rows[0]) setSelected(rows[0].id);
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
    <div className="terminal-panel">
      <div className="terminal-toolbar">
        {!!sessions.length && (
          <Picker
            label={t('ptySession')}
            value={selected}
            onChange={setSelected}
            options={sessions.map((row) => ({
              value: row.id,
              label: `${new Date(row.createdAt).toLocaleTimeString()} · ${t(row.status === 'running' ? 'ptyRunning' : 'ptyEnded')}`,
            }))}
          />
        )}
        <IconButton
          label={t('ptyNew')}
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
        </IconButton>
        {session?.status === 'running' && (
          <IconButton
            label={t('ptyStop')}
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await window.moose.request('terminalStop', { id: session.id });
              })
            }
          >
            <Square />
          </IconButton>
        )}
        {session && (
          <span className="terminal-context" title={session.cwd}>
            {session.cwd.split('/').pop()}
            {session.status !== 'running' && ` · ${t('ptyEnded')} (${session.exitCode ?? '—'})`}
          </span>
        )}
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {session ? (
        <>
          <TerminalView key={session.id} session={session} onError={setError} />
        </>
      ) : (
        <p className="extension-note">{t('ptyEmpty')}</p>
      )}
    </div>
  );
}
