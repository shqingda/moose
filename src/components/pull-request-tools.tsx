import { Field, FieldLabel } from './ui/field';
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
    [failure, setFailure] = useState(''),
    [sameBranch, setSameBranch] = useState(false),
    [targetOpen, setTargetOpen] = useState(false);
  async function load() {
    setBusy(true);
    setSameBranch(false);
    setFailure('');
    setPreview(undefined);
    setUrl('');
    try {
      const next = await window.moose.request('prPreview', { ...scope, base });
      setPreview(next);
      setTitle((value) => value || next.branch.replace(/[-_/]/g, ' '));
    } catch (error) {
      if (String(error).includes('Choose a different PR base branch')) {
        setSameBranch(true);
        setTargetOpen(true);
      } else {
        setFailure(String(error));
      }
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
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        {t('prTools')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="git-action-dialog">
          <DialogHeader>
            <DialogTitle>{t('prTools')}</DialogTitle>
            <DialogDescription>{t('prHint')}</DialogDescription>
          </DialogHeader>
          <div className="git-action-body">
            {failure && (
              <div>
                <p role="alert" className="text-destructive break-words">
                  {failure}
                </p>
                <Button variant="outline" disabled={busy || !base.trim()} onClick={load}>
                  {t('refresh')}
                </Button>
              </div>
            )}
            {sameBranch && <p role="status">{t('prSameBranch')}</p>}
            <details
              className="git-action-details"
              open={targetOpen}
              onToggle={(event) => setTargetOpen(event.currentTarget.open)}
            >
              <summary>
                {t('prTarget')}: {base}
              </summary>
              <Field>
                <FieldLabel htmlFor="pr-base">{t('prBase')}</FieldLabel>
                <Input
                  id="pr-base"
                  aria-label={t('prBase')}
                  value={base}
                  disabled={busy}
                  onChange={(e) => {
                    setBase(e.target.value);
                    setSameBranch(false);
                    setPreview(undefined);
                    setUrl('');
                  }}
                />
              </Field>
              <Button variant="outline" disabled={busy || !base.trim()} onClick={load}>
                {t('prPreview')}
              </Button>
            </details>
            {busy && <p role="status">{t('loading')}</p>}
            {preview && (
              <>
                <p>
                  {preview.repository}: {preview.branch} → {preview.base}
                </p>
                {preview.existing.map((pr) => (
                  <Button key={pr.number} variant="link" onClick={() => visit(pr.url)}>
                    #{pr.number} {pr.state}: {pr.title}
                  </Button>
                ))}
                <details className="git-action-details">
                  <summary>{t('gitViewChanges')}</summary>
                  <pre>{preview.commits}</pre>
                  <pre className="whitespace-pre-wrap break-all text-xs">{preview.diff}</pre>
                  {preview.truncated && <p>{t('truncated')}</p>}
                </details>
              </>
            )}
            {url ? (
              <Button variant="link" onClick={() => visit(url)}>
                {url}
              </Button>
            ) : !preview || preview.existing.some((pr) => pr.state === 'OPEN') ? null : (
              <>
                <Field>
                  <FieldLabel htmlFor="pr-title">{t('prTitle')}</FieldLabel>
                  <Input
                    id="pr-title"
                    aria-label={t('prTitle')}
                    placeholder={t('prTitle')}
                    value={title}
                    disabled={busy}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="pr-body">{t('prBody')}</FieldLabel>
                  <Textarea
                    id="pr-body"
                    aria-label={t('prBody')}
                    placeholder={t('prBody')}
                    value={body}
                    disabled={busy}
                    onChange={(e) => setBody(e.target.value)}
                  />
                </Field>
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
