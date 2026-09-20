import { useEffect, useState } from 'react';
import type { Project, Provider, Session } from '../../shared/types';
import type { NativeCapabilities, NativeEntry, NativeThread } from '../../shared/native-sessions';
import { useI18n } from '../lib/i18n';
import { useTranscript } from '../lib/workspace';
import { Button } from './ui/button';
import { NativePreview } from './native-preview';

export function NativeTools({
  project,
  provider,
  session,
  onSelect,
}: {
  project: Project;
  provider: Provider;
  session?: Session;
  onSelect(session: Session): void;
}) {
  const t = useI18n();
  const [caps, setCaps] = useState<NativeCapabilities>();
  const [threads, setThreads] = useState<NativeThread[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<NativeThread>();
  const [items, setItems] = useState<NativeEntry[]>([]),
    [itemCursor, setItemCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [checkpoint, setCheckpoint] = useState('');
  const { messages, earlier: loadMore, hasMore: more } = useTranscript(session?.id, setError);
  const turns = [
    ...new Map(
      messages
        .filter((m) => m.kind === 'user' && m.nativeTurnId && !m.delivery)
        .map((m) => [m.nativeTurnId!, m]),
    ).values(),
  ];
  useEffect(() => {
    let disposed = false;
    setBusy(true);
    void (async () => {
      const capabilities = await window.moose.request('nativeCapabilities', { provider });
      if (disposed) return;
      setCaps(capabilities);
      if (capabilities.history) {
        const page = await window.moose.request('nativeList', {
          projectId: project.id,
          sessionId: session?.id,
          provider,
        });
        if (!disposed) {
          setThreads(page.data);
          setCursor(page.nextCursor);
        }
      }
    })()
      .catch((e) => {
        if (!disposed) setError(String(e));
      })
      .finally(() => {
        if (!disposed) setBusy(false);
      });
    return () => {
      disposed = true;
    };
  }, [project.id, provider]);
  async function act(body: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await body();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const preview = async (thread: NativeThread, next?: string) => {
    const result = await window.moose.request('nativeRead', {
      projectId: project.id,
      sessionId: session?.id,
      provider,
      nativeId: thread.id,
      cursor: next,
    });
    setSelected(result.thread);
    setItems((old) => (next ? [...old, ...result.items.data] : result.items.data));
    setItemCursor(result.items.nextCursor);
  };
  const idle =
    session && !session.archived && !['running', 'waiting', 'queued'].includes(session.status);
  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-auto">
      {error && (
        <p role="alert" className="text-destructive whitespace-pre-wrap">
          {error}
        </p>
      )}
      {busy && <p role="status">{t('nativeWorking')}</p>}
      {notice && <p role="status">{notice}</p>}
      {caps?.reason && <p className="text-sm text-muted-foreground">{caps.reason}</p>}
      {session?.nativeId && (
        <section className="native-session-section">
          <h3>{t('nativeCurrent')}</h3>
          <code className="break-all text-xs">{session.nativeId}</code>
          {session.nativeOrigin && (
            <p className="text-xs break-all">
              {t('nativeOrigin')}: {session.nativeOrigin.sourceNativeId}
              {session.nativeOrigin.forkTurnId && ` · ${session.nativeOrigin.forkTurnId}`}
            </p>
          )}
          <p className="text-sm text-muted-foreground">{t('nativeForkHint')}</p>
          <div className="flex flex-wrap gap-2">
            {turns.map((m) => (
              <Button
                key={m.nativeTurnId}
                size="sm"
                variant={checkpoint === m.nativeTurnId ? 'default' : 'outline'}
                disabled={busy || !idle || !caps?.fork}
                onClick={() => setCheckpoint(m.nativeTurnId!)}
              >
                {m.text.slice(0, 60) || m.nativeTurnId}
              </Button>
            ))}
            {more && (
              <Button variant="ghost" disabled={busy} onClick={() => void loadMore()}>
                {t('nativeOlderTurns')}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || !idle || !caps?.fork || !checkpoint}
              onClick={() =>
                void act(async () => {
                  onSelect(
                    await window.moose.request('nativeFork', {
                      sessionId: session.id,
                      turnId: checkpoint,
                      requestId: crypto.randomUUID(),
                    }),
                  );
                })
              }
            >
              {t('nativeFork')}
            </Button>
            <Button
              variant="outline"
              disabled={busy || !idle || !caps?.compact}
              onClick={() =>
                void act(async () => {
                  await window.moose.request('nativeCompact', {
                    sessionId: session.id,
                    requestId: crypto.randomUUID(),
                  });
                  setNotice(t('nativeCompacted'));
                })
              }
            >
              {t('nativeCompact')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('nativeCompactHint')}</p>
        </section>
      )}
      <h3>{t('nativeHistory')}</h3>
      <div className="flex flex-col gap-1">
        {threads.map((thread) => (
          <Button
            className="h-auto justify-start whitespace-normal text-left"
            variant={selected?.id === thread.id ? 'secondary' : 'ghost'}
            key={thread.id}
            disabled={busy}
            onClick={() => void act(() => preview(thread))}
          >
            {thread.title}
          </Button>
        ))}
        {!threads.length && !busy && (
          <p className="text-sm text-muted-foreground">{t('noResults')}</p>
        )}
        {cursor && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const page = await window.moose.request('nativeList', {
                  projectId: project.id,
                  sessionId: session?.id,
                  provider,
                  cursor,
                });
                setThreads((old) => [
                  ...new Map([...old, ...page.data].map((row) => [row.id, row])).values(),
                ]);
                setCursor(page.nextCursor);
              })
            }
          >
            {t('nativeMore')}
          </Button>
        )}
      </div>
      {selected && (
        <section className="flex min-h-0 flex-col gap-3 border-t pt-3">
          <code className="break-all text-xs">{selected.id}</code>
          <Button
            disabled={busy || selected.status === 'active'}
            onClick={() =>
              void act(async () => {
                onSelect(
                  await window.moose.request('nativeImport', {
                    projectId: project.id,
                    sessionId: session?.id,
                    provider,
                    nativeId: selected.id,
                  }),
                );
              })
            }
          >
            {t('nativeImport')}
          </Button>
          <NativePreview
            items={items}
            more={!!itemCursor}
            busy={busy}
            load={() => void act(() => preview(selected, itemCursor!))}
          />
        </section>
      )}
    </div>
  );
}
