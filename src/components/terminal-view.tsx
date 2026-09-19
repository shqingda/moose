import { useEffect, useRef, useState } from 'react';
import type { TerminalSession } from '../../shared/terminal';
import { useI18n } from '../lib/i18n';
import '@xterm/xterm/css/xterm.css';
export function TerminalView({
  session,
  onError,
}: {
  session: TerminalSession;
  onError(error: string): void;
}) {
  const host = useRef<HTMLDivElement>(null),
    error = useRef(onError);
  error.current = onError;
  const t = useI18n(),
    [truncated, setTruncated] = useState(false);
  useEffect(() => {
    let dispose = () => {},
      cancelled = false;
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (cancelled || !host.current) return;
      const term = new Terminal({
        cols: session.cols,
        rows: session.rows,
        cursorBlink: true,
        fontFamily: 'Menlo, monospace',
        fontSize: 13,
        scrollback: 3000,
        allowProposedApi: false,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host.current);
      // No link or clipboard addons: terminal output cannot open URLs or write the clipboard.
      let offset = 0,
        polling = false,
        replay = true,
        running = session.status === 'running';
      let input = Promise.resolve();
      const data = term.onData((text) => {
        if (replay || !running) return;
        input = input
          .then(async () => {
            for (let i = 0; i < text.length; i += 8000)
              await window.moose.request('terminalInput', {
                id: session.id,
                text: text.slice(i, i + 8000),
              });
          })
          .catch((e) => error.current(String(e)));
      });
      term.attachCustomKeyEventHandler((event) => {
        if (event.type === 'keydown' && event.metaKey && event.key === 'c' && term.hasSelection()) {
          void navigator.clipboard
            .writeText(term.getSelection())
            .catch((e) => error.current(String(e)));
          return false;
        }
        return true;
      });
      const theme = () => {
        const dark = document.documentElement.classList.contains('dark');
        term.options.theme = dark
          ? { background: '#20262e', foreground: '#e5e9ee', cursor: '#a0c8ca' }
          : { background: '#ffffff', foreground: '#20262e', cursor: '#376f75' };
        term.options.fontSize =
          (13 * parseFloat(getComputedStyle(document.documentElement).fontSize)) / 16;
      };
      theme();
      const themeObserver = new MutationObserver(theme);
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'style'],
      });
      const resize = () => {
        if (!host.current?.clientWidth || !host.current.clientHeight) return;
        fit.fit();
        if (running)
          void window.moose
            .request('terminalResize', {
              id: session.id,
              cols: Math.max(2, Math.min(500, term.cols)),
              rows: Math.max(1, Math.min(200, term.rows)),
            })
            .catch((e) => error.current(String(e)));
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host.current);
      const poll = async () => {
        if (polling || cancelled) return;
        polling = true;
        try {
          const update = await window.moose.request('terminalRead', { id: session.id, offset });
          if (cancelled) return;
          running = update.session.status === 'running';
          if (update.reset) {
            term.reset();
            setTruncated(true);
            replay = true;
          }
          await new Promise<void>((resolve) => term.write(update.data, resolve));
          offset = update.offset;
          replay = false;
          term.options.disableStdin = !running;
        } catch (e) {
          if (!cancelled) error.current(String(e));
        } finally {
          polling = false;
        }
      };
      void poll();
      const timer = setInterval(() => void poll(), 100);
      term.focus();
      dispose = () => {
        clearInterval(timer);
        observer.disconnect();
        themeObserver.disconnect();
        data.dispose();
        term.dispose();
      };
    })().catch((e) => {
      if (!cancelled) error.current(String(e));
    });
    return () => {
      cancelled = true;
      dispose();
    };
  }, [session.id]);
  return (
    <>
      {truncated && <p className="extension-note">{t('ptyTruncated')}</p>}
      <div ref={host} className="terminal-screen" role="region" aria-label={t('ptyScreen')} />
    </>
  );
}
