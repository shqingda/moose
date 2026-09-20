import { useEffect, useRef, useState } from 'react';
import type { TerminalSession } from '../../shared/terminal';
import { terminalThemes } from '../lib/terminal-theme';
import { terminalStream } from '../lib/terminal-stream';
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
    [truncated, setTruncated] = useState(false),
    [controlled, setControlled] = useState(true);
  const takeControl = useRef(() => {});
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
      let replay = true,
        owned = false,
        lease: string | undefined,
        running = session.status === 'running';
      term.options.disableStdin = true;
      let input = Promise.resolve();
      const data = term.onData((text) => {
        if (replay || !running || !owned || !lease) return;
        const inputLease = lease;
        input = input
          .then(async () => {
            for (let i = 0; i < text.length; i += 8000) {
              if (cancelled || !owned || lease !== inputLease) return;
              await window.moose.request('terminalInput', {
                id: session.id,
                text: text.slice(i, i + 8000),
                lease: inputLease,
              });
            }
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
        const palette = dark ? terminalThemes.mocha : terminalThemes.githubLight;
        const style = getComputedStyle(document.documentElement);
        const background = style.getPropertyValue('--background').trim();
        term.options.theme = {
          ...palette,
          background,
          foreground: style.getPropertyValue('--foreground').trim(),
          cursor: style.getPropertyValue('--primary').trim(),
          cursorAccent: background,
        };
        host.current?.style.setProperty('background-color', background);
        host.current?.style.setProperty('--terminal-background', background);
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
        if (!owned) return;
        fit.fit();
        if (running)
          void window.moose
            .request('terminalResize', {
              id: session.id,
              lease,
              cols: Math.max(2, Math.min(500, term.cols)),
              rows: Math.max(1, Math.min(200, term.rows)),
            })
            .catch((e) => error.current(String(e)));
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host.current);
      const stream = terminalStream(
        (offset) => window.moose.request('terminalRead', { id: session.id, offset }),
        async (update) => {
          if (cancelled) return;
          running = update.session.status === 'running';
          if (!owned) term.resize(update.session.cols, update.session.rows);
          if (update.reset) {
            term.reset();
            setTruncated(true);
            replay = true;
          }
          await new Promise<void>((resolve) => term.write(update.data, resolve));
          replay = false;
          term.options.disableStdin = !running || !owned;
        },
        (e) => {
          if (!cancelled) error.current(String(e));
        },
      );
      let controlQueue = Promise.resolve();
      let renewalPending = false;
      const control = (action: 'acquire' | 'takeover' | 'renew') => {
        if (action === 'renew' && renewalPending) return;
        if (action === 'renew') renewalPending = true;
        controlQueue = controlQueue
          .then(async () => {
            if (cancelled || !running) return;
            const result = await window.moose.request('terminalControl', {
              id: session.id,
              action,
              lease,
            });
            if (cancelled) {
              if (result.lease)
                await window.moose.request('terminalControl', {
                  id: session.id,
                  action: 'release',
                  lease: result.lease,
                });
              return;
            }
            const gained = result.owned && !owned;
            owned = result.owned;
            lease = result.lease ?? undefined;
            setControlled(owned);
            term.options.disableStdin = replay || !running || !owned;
            if (gained) resize();
          })
          .catch((e) => {
            if (cancelled) return;
            owned = false;
            setControlled(false);
            term.options.disableStdin = true;
            if (action !== 'renew') error.current(String(e));
          })
          .finally(() => {
            if (action === 'renew') renewalPending = false;
          });
      };
      takeControl.current = () => control('takeover');
      control('acquire');
      const heartbeat = setInterval(() => control('renew'), 5000);
      const unsubscribe = window.moose.subscribe((event) => {
        if (event.type === 'terminal-control' && event.id === session.id) control('renew');
        if (event.type === 'terminal-output' && event.output.session.id === session.id)
          stream.push(event.output);
        else if (event.type === 'terminal-sync') {
          stream.sync();
          control('renew');
        } else if (event.type === 'runtime-error') {
          owned = false;
          setControlled(false);
          replay = true;
          term.options.disableStdin = true;
        }
      });
      stream.sync();
      term.focus();
      dispose = () => {
        clearInterval(heartbeat);
        takeControl.current = () => {};
        if (lease)
          void window.moose
            .request('terminalControl', {
              id: session.id,
              action: 'release',
              lease,
            })
            .catch(() => {});
        unsubscribe();
        stream.close();
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
      {!controlled && session.status === 'running' && (
        <div className="flex items-center justify-between gap-3 px-4 py-1 text-sm text-muted-foreground">
          <span>{t('ptyReadOnly')}</span>
          <button
            type="button"
            className="shrink-0 rounded-md px-2 py-1 hover:bg-muted"
            onClick={() => takeControl.current()}
          >
            {t('ptyTakeControl')}
          </button>
        </div>
      )}
      {truncated && <p className="extension-note">{t('ptyTruncated')}</p>}
      <div
        ref={host}
        className="terminal-screen"
        data-read-only={!controlled || undefined}
        role="region"
        aria-label={t('ptyScreen')}
      />
    </>
  );
}
