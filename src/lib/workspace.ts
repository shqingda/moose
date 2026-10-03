import { fault, type Fault } from '../../shared/errors';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Snapshot, TranscriptPage } from '../../shared/types';
import { mergeTranscriptPage } from './transcript-messages';
/** 维护全局快照和错误；合并后台刷新通知，并阻止旧请求覆盖新快照。 */
export function useWorkspace() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [failure, setFailure] = useState<Fault>();
  const [connection, setConnection] = useState<Fault>();
  const error = failure?.message || '';
  const setError = useCallback(
    (value: unknown) => setFailure(value ? fault(value) : undefined),
    [],
  );
  const requestGeneration = useRef(0);
  // 刷新快照并使用请求代次丢弃迟到结果。
  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current;
    try {
      const data = await window.moose.request('snapshot', {});
      if (generation === requestGeneration.current) {
        setSnapshot(data);
        setConnection(undefined);
      }
    } catch (error) {
      if (generation === requestGeneration.current) setConnection(fault(error));
    }
  }, []);
  useEffect(() => {
    void refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = window.moose.subscribe((event) => {
      if (event.type === 'changed' || event.type === 'appearance') {
        clearTimeout(timer);
        timer = setTimeout(() => {
          void refresh();
        }, 60);
      }
      if (event.type === 'runtime-error')
        setConnection({ code: event.code || 'disconnected', message: event.error });
      if (event.type === 'runtime-connected') {
        setConnection(undefined);
        void refresh();
      }
    });
    return () => {
      requestGeneration.current++;
      unsubscribe();
      clearTimeout(timer);
    };
  }, [refresh]);
  // 统一捕获界面异步操作错误，交由全局错误提示展示。
  const perform = useCallback(async <T>(action: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await action();
    } catch (error) {
      setError(error);
      return undefined;
    }
  }, []);
  return { snapshot, error, failure, connection, setError, refresh, perform };
}
/** 管理会话分页与实时订阅；切换或重置会话时使旧异步请求失效。 */
export function useTranscript(
  sessionId: string | undefined,
  report: (error: unknown) => void,
  targetMessage?: string,
) {
  const [page, setPage] = useState<TranscriptPage>({ messages: [], hasMore: false });
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    let current = ++generation.current;
    setPage({ messages: [], hasMore: false });
    if (!sessionId) return;
    setLoading(true);
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const fetch = async (initial = false) => {
      const requestGeneration = current;
      try {
        const data = targetMessage
          ? await window.moose.request('locateMessage', { sessionId, messageId: targetMessage })
          : await window.moose.request('messages', { sessionId });
        if (requestGeneration === generation.current)
          setPage((old) =>
            mergeTranscriptPage(old, data.messages, initial ? data.hasMore : old.hasMore),
          );
      } catch (error) {
        if (requestGeneration === generation.current) report(error);
      } finally {
        if (requestGeneration === generation.current) setLoading(false);
      }
    };
    const unsubscribe = window.moose.subscribe((event) => {
      if (event.type === 'transcript-reset' && event.sessionId === sessionId) {
        current = ++generation.current;
        setPage({ messages: [], hasMore: false });
        void fetch(true);
      }
      if (event.type === 'message' && event.message.sessionId === sessionId)
        setPage((old) =>
          targetMessage && !old.messages.some((m) => m.id === event.message.id)
            ? old
            : mergeTranscriptPage(old, [event.message]),
        );
      if (event.type === 'changed') {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          void fetch();
        }, 100);
      }
    });
    void fetch(true);
    return () => {
      generation.current++;
      unsubscribe();
      clearTimeout(refreshTimer);
    };
  }, [sessionId, report, targetMessage]);
  /** 用最早消息的 position 加载上一页，并合并到现有时间线。 */
  const earlier = async () => {
    if (!sessionId || loading) return;
    const current = generation.current;
    setLoading(true);
    try {
      const data = await window.moose.request('messages', {
        sessionId,
        before: page.messages[0]?.position,
      });
      if (current === generation.current)
        setPage((old) => mergeTranscriptPage(old, data.messages, data.hasMore));
    } catch (error) {
      if (current === generation.current) report(error);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  };
  return { ...page, loading, earlier };
}
