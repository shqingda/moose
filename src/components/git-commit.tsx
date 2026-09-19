import { useState } from 'react';
import type { CommitPreview, WorkspaceScope } from '../../shared/git-actions';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Textarea } from './ui/textarea';
export function GitCommit({ scope, changed }: { scope: WorkspaceScope; changed(): void }) {
  const t = useI18n(),
    [open, setOpen] = useState(false),
    [preview, setPreview] = useState<CommitPreview>(),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState(''),
    [failure, setFailure] = useState('');
  async function load() {
    setOpen(true);
    setPreview(undefined);
    setResult('');
    setBusy(true);
    setFailure('');
    try {
      setPreview(await window.moose.request('gitCommitPreview', scope));
    } catch (error) {
      setFailure(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!preview) return;
    setBusy(true);
    setFailure('');
    try {
      const sha = await window.moose.request('gitCommit', {
        ...scope,
        preview: { head: preview.head, branch: preview.branch, fingerprint: preview.fingerprint },
        message,
        requestId: crypto.randomUUID(),
      });
      setResult(sha);
      setPreview(undefined);
      setMessage('');
      changed();
    } catch (error) {
      setFailure(String(error));
      setPreview(undefined);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button size="sm" variant="outline" disabled={busy} onClick={load}>
        {t('gitCommitPreview')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="native-dialog">
          <DialogHeader>
            <DialogTitle>{t('gitCommitPreview')}</DialogTitle>
            <DialogDescription>{t('gitCommitHint')}</DialogDescription>
          </DialogHeader>
          <div className="native-dialog-body space-y-3">
            {failure && (
              <p role="alert" className="text-destructive break-words">
                {failure}
              </p>
            )}
            {result && (
              <p role="status">
                {t('gitCommitted')}: {result}
              </p>
            )}
            {preview && (
              <>
                <p>
                  {preview.branch} · {preview.head?.slice(0, 12) || 'HEAD'}
                </p>
                <pre className="whitespace-pre-wrap break-all text-xs">
                  {preview.files.join('\n')}
                </pre>
                <pre className="whitespace-pre-wrap break-all text-xs">{preview.diff}</pre>
                {preview.truncated && <p>{t('truncated')}</p>}
              </>
            )}
            {!result && (
              <>
                <Textarea
                  aria-label={t('gitMessage')}
                  placeholder={t('gitMessage')}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={busy}
                />
                <div className="flex gap-2">
                  <Button variant="outline" disabled={busy} onClick={load}>
                    {t('refresh')}
                  </Button>
                  <Button
                    disabled={busy || !preview?.files.length || !message.trim()}
                    onClick={commit}
                  >
                    {t('gitCommit')}
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
