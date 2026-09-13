import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message, Snapshot, TranscriptPage } from '../../shared/types';
export function useWorkspace() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState('');
  const requestGeneration = useRef(0);
  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current;
    try { const data = await window.moose.request('snapshot', {}); if (generation === requestGeneration.current) setSnapshot(data); }
    catch (error) { setError(String(error)); }
  }, []);
  useEffect(() => {
    void refresh(); let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = window.moose.subscribe(event => {
      if (event.type === 'changed' || event.type === 'appearance') { clearTimeout(timer); timer = setTimeout(() => { void refresh(); }, 60); }
      if (event.type === 'runtime-error') setError(event.error);
    });
    return () => { unsubscribe(); clearTimeout(timer); };
  }, [refresh]);
  const perform = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    try { return await action(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); return undefined; }
  }, []);
  return { snapshot, error, setError, refresh, perform };
}
export function mergeMessages(previous: Message[], incoming: Message[]) {
  const rows = new Map(previous.map(row => [row.id, row]));
  for (const row of incoming) { const old = rows.get(row.id); if (!old || old.seq < row.seq) rows.set(row.id, row); }
  return [...rows.values()].sort((a, b) => a.position - b.position);
}
export function useTranscript(sessionId: string | undefined, report: (error: string) => void) {
  const [page, setPage] = useState<TranscriptPage>({ messages: [], hasMore: false });
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setPage({ messages: [], hasMore: false });
    if (!sessionId) return;
    setLoading(true);
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const fetch = async (initial = false) => {
      try {
        const data = await window.moose.request('messages', { sessionId });
        if (current === generation.current) setPage(old => ({ messages: mergeMessages(old.messages, data.messages), hasMore: initial ? data.hasMore : old.hasMore }));
      } catch (error) { if (current === generation.current) report(String(error)); }
      finally { if (current === generation.current) setLoading(false); }
    };
    const unsubscribe = window.moose.subscribe(event => {
      if (event.type === 'message' && event.message.sessionId === sessionId) setPage(old => ({ ...old, messages: mergeMessages(old.messages, [event.message]) }));
      if (event.type === 'changed') { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { void fetch(); }, 100); }
    });
    void fetch(true);
    return () => { generation.current++; unsubscribe(); clearTimeout(refreshTimer); };
  }, [sessionId, report]);
  const earlier = async () => {
    if (!sessionId || loading) return;
    const current = generation.current; setLoading(true);
    try { const data = await window.moose.request('messages', { sessionId, before: page.messages[0]?.position }); if (current === generation.current) setPage(old => ({ messages: mergeMessages(old.messages, data.messages), hasMore: data.hasMore })); }
    catch (error) { report(String(error)); }
    finally { if (current === generation.current) setLoading(false); }
  };
  return { ...page, loading, earlier };
}
