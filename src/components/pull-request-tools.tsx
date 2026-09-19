import { useState } from 'react';
import type { PullRequestPreview, WorkspaceScope } from '../../shared/git-actions';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
export function PullRequestTools({ scope }: { scope: WorkspaceScope }) {
  const t = useI18n(),
    [open, setOpen] = useState(false),
    [base, setBase] = useState('main'),
    [title, setTitle] = useState(''),
    [body, setBody] = useState(''),
    [preview, setPreview] = useState<PullRequestPreview>(),
    [busy, setBusy] = useState(false),
    [url, setUrl] = useState(''),
    [failure, setFailure] = useState('');
  async function load() {
    setBusy(true);
    setFailure('');
    setPreview(undefined);
    setUrl('');
    try {
      setPreview(await window.moose.request('prPreview', { ...scope, base }));
    } catch (error) {
      setFailure(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    if (!preview) return;
    setBusy(true);
    setFailure('');
    try {
      setUrl(
        await window.moose.request('prCreate', {
          ...scope,
          preview: {
            repository: preview.repository,
            branch: preview.branch,
            head: preview.head,
            base: preview.base,
            baseCommit: preview.baseCommit,
          },
          title,
          body,
          requestId: crypto.randomUUID(),
        }),
      );
      setPreview(undefined);
    } catch (error) {
      setFailure(String(error));
      setPreview(undefined);
    } finally {
      setBusy(false);
    }
  }
  function visit(value: string) {
    void window.moose
      .request('openExternal', { url: value })
      .catch((error) => setFailure(String(error)));
  }
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t('prTools')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="native-dialog">
          <DialogHeader>
            <DialogTitle>{t('prTools')}</DialogTitle>
            <DialogDescription>{t('prHint')}</DialogDescription>
          </DialogHeader>
          <div className="native-dialog-body space-y-3">
            {failure && (
              <p role="alert" className="text-destructive break-words">
                {failure}
              </p>
            )}
            <Input
              aria-label={t('prBase')}
              value={base}
              disabled={busy}
              onChange={(e) => {
                setBase(e.target.value);
                setPreview(undefined);
                setUrl('');
              }}
            />
            <Button variant="outline" disabled={busy || !base.trim()} onClick={load}>
              {t('prPreview')}
            </Button>
            {preview && (
              <>
                <p>
                  {preview.repository}: {preview.branch} → {preview.base}
                </p>
                <p className="text-xs">
                  {preview.head.slice(0, 12)} → {preview.baseCommit.slice(0, 12)}
                </p>
                {preview.existing.map((pr) => (
                  <Button key={pr.number} variant="link" onClick={() => visit(pr.url)}>
                    #{pr.number} {pr.state}: {pr.title}
                  </Button>
                ))}
                <pre className="whitespace-pre-wrap break-all text-xs">{preview.commits}</pre>
                <pre className="whitespace-pre-wrap break-all text-xs">{preview.diff}</pre>
                {preview.truncated && <p>{t('truncated')}</p>}
              </>
            )}
            {url ? (
              <Button variant="link" onClick={() => visit(url)}>
                {url}
              </Button>
            ) : preview?.existing.some((pr) => pr.state === 'OPEN') ? null : (
              <>
                <Input
                  aria-label={t('prTitle')}
                  placeholder={t('prTitle')}
                  value={title}
                  disabled={busy}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <Textarea
                  aria-label={t('prBody')}
                  placeholder={t('prBody')}
                  value={body}
                  disabled={busy}
                  onChange={(e) => setBody(e.target.value)}
                />
                <Button disabled={busy || !preview || !title.trim()} onClick={create}>
                  {t('prCreate')}
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
