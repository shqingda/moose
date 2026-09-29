import { useEffect, useRef } from 'react';
import type { Settings } from '../../shared/types';
import { useI18n } from './i18n';
export function useNotifications(
  sessionId: string | undefined,
  settings: Settings,
  navigate: (sessionId: string, messageId?: string) => void,
) {
  const t = useI18n(),
    current = useRef({ sessionId, settings, navigate, t });
  current.current = { sessionId, settings, navigate, t };
  useEffect(() => {
    const presence = () =>
      window.moose
        .request('clientPresence', {
          sessionId: current.current.sessionId,
          focused: document.visibilityState === 'visible' && document.hasFocus(),
        })
        .catch(() => {});
    void presence();
    const stop = window.moose.subscribe((event) => {
      if (event.type === 'navigate') current.current.navigate(event.sessionId, event.messageId);
      if (event.type === 'runtime-connected') void presence();
      if (event.type !== 'task-notice' || window.moose.host !== 'web') return;
      const { notice } = event;
      if (
        !(notice.kind === 'attention'
          ? current.current.settings.notifyAttention
          : current.current.settings.notifyResults)
      )
        return;
      void (async () => {
        if ((await window.moose.request('notificationPermission', {})) !== 'granted') return;
        await presence();
        const claimed = await window.moose.request('claimNotice', { id: notice.id });
        if (claimed)
          await window.moose.request('showNotification', {
            notice: claimed,
            label: current.current.t(`notice_${claimed.kind}`),
          });
      })().catch(() => {});
    });
    const change = () => void presence();
    const hide = () =>
      void window.moose
        .request('clientPresence', { sessionId: current.current.sessionId, focused: false })
        .catch(() => {});
    window.addEventListener('pagehide', hide);
    window.addEventListener('focus', change);
    window.addEventListener('blur', change);
    document.addEventListener('visibilitychange', change);
    const timer = setInterval(change, 15000);
    return () => {
      clearInterval(timer);
      stop();
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('focus', change);
      window.removeEventListener('blur', change);
      document.removeEventListener('visibilitychange', change);
    };
  }, []);
  useEffect(() => {
    void window.moose
      .request('clientPresence', {
        sessionId,
        focused: document.visibilityState === 'visible' && document.hasFocus(),
      })
      .catch(() => {});
  }, [sessionId]);
}
