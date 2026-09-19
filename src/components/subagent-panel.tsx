import { useEffect, useState } from 'react';
import type { NativeEntry, NativeThread } from '../../shared/native-sessions';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { NativePreview } from './native-preview';

export function SubagentPanel({ sessionId, nativeId }: { sessionId: string; nativeId: string }) {
  const t = useI18n(),
    [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t('nativeOpenChild')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="native-dialog">
          <DialogHeader>
            <DialogTitle>{t('subagents')}</DialogTitle>
            <DialogDescription className="break-all">{nativeId}</DialogDescription>
          </DialogHeader>
          {open && <ChildContent sessionId={sessionId} nativeId={nativeId} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
function ChildContent({ sessionId, nativeId }: { sessionId: string; nativeId: string }) {
  const t = useI18n();
  const [thread, setThread] = useState<NativeThread>(),
    [items, setItems] = useState<NativeEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [text, setText] = useState('');
  const [controllable, setControllable] = useState(false);
  const apply = (data: Awaited<ReturnType<typeof read>>, next?: string) => {
    setThread(data.thread);
    setItems((old) => (next ? [...old, ...data.items.data] : data.items.data));
    setCursor(data.items.nextCursor);
    setControllable(!!data.controllable);
  };
  const read = (next?: string) =>
    window.moose.request('childRead', { sessionId, nativeId, cursor: next });
  useEffect(() => {
    let disposed = false;
    setBusy(true);
    void read()
      .then((data) => {
        if (!disposed) apply(data);
      })
      .catch((e) => {
        if (!disposed) setError(String(e));
      })
      .finally(() => {
        if (!disposed) setBusy(false);
      });
    return () => {
      disposed = true;
    };
  }, [sessionId, nativeId]);
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
  const control = (action: 'send' | 'stop' | 'resume') =>
    void act(async () => {
      await window.moose.request('childControl', {
        sessionId,
        nativeId,
        action,
        text: action === 'send' ? text : undefined,
        requestId: crypto.randomUUID(),
      });
      if (action === 'send') setText('');
      setNotice(t('nativeControlAccepted'));
      apply(await read());
    });
  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-auto">
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">{t('nativeWorking')}</p>}
      {thread && (
        <div className="text-sm break-all">
          <p>
            {t('nativeParent')}: {thread.parentId}
          </p>
          <p>
            {thread.status} · {thread.model} · {thread.effort}
          </p>
        </div>
      )}
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => void act(async () => apply(await read()))}
      >
        {t('nativeRefresh')}
      </Button>
      <NativePreview
        items={items}
        more={!!cursor}
        busy={busy}
        load={() => void act(async () => apply(await read(cursor!), cursor!))}
      />
      <p className="text-xs text-muted-foreground">
        {t('nativeChildHint')} {t('nativeResumeUnsupported')}
      </p>
      <Textarea
        aria-label={t('nativeChildMessage')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy || !controllable || !thread?.canAcceptInput}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || !controllable || !thread?.canAcceptInput || !text.trim()}
          onClick={() => control('send')}
        >
          {t('nativeChildSend')}
        </Button>
        <Button
          variant="outline"
          disabled={busy || !controllable || thread?.status !== 'active'}
          onClick={() => control('stop')}
        >
          {t('agentInterrupt')}
        </Button>
        <Button
          variant="outline"
          disabled
          title={t('nativeResumeUnsupported')}
          onClick={() => control('resume')}
        >
          {t('agentResume')}
        </Button>
      </div>
    </div>
  );
}
