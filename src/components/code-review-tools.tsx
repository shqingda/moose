import { useEffect, useState } from 'react';
import type { CodeReview, ReviewTarget, WorkspaceScope } from '../../shared/git-actions';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
export function CodeReviewTools({ scope }: { scope: WorkspaceScope }) {
  const t = useI18n(),
    [open, setOpen] = useState(false),
    [kind, setKind] = useState<ReviewTarget['type']>('uncommittedChanges'),
    [ref, setRef] = useState(''),
    [rows, setRows] = useState<CodeReview[]>([]),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [failure, setFailure] = useState('');
  useEffect(() => {
    if (!open) return;
    let live = true,
      loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      try {
        const result = await window.moose.request('reviewList', scope);
        if (live) setRows(result);
      } catch (error) {
        if (live) setFailure(String(error));
      } finally {
        loading = false;
      }
    }
    void load();
    const timer = setInterval(() => void load(), 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [open, scope.projectId, scope.sessionId, revision]);
  async function start() {
    if (!scope.sessionId) return;
    setBusy(true);
    setFailure('');
    try {
      const target: ReviewTarget =
        kind === 'commit'
          ? { type: kind, sha: ref }
          : kind === 'baseBranch'
            ? { type: kind, branch: ref }
            : { type: kind };
      await window.moose.request('reviewStart', {
        projectId: scope.projectId,
        sessionId: scope.sessionId,
        target,
        requestId: crypto.randomUUID(),
      });
      setRevision((n) => n + 1);
    } catch (error) {
      setFailure(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function stop(id: string) {
    try {
      await window.moose.request('reviewStop', { projectId: scope.projectId, id });
      setRevision((n) => n + 1);
    } catch (error) {
      setFailure(String(error));
    }
  }
  return (
    <>
      <Button size="sm" variant="outline" disabled={!scope.sessionId} onClick={() => setOpen(true)}>
        {t('codeReview')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="native-dialog">
          <DialogHeader>
            <DialogTitle>{t('codeReview')}</DialogTitle>
            <DialogDescription>{t('codeReviewHint')}</DialogDescription>
          </DialogHeader>
          <div className="native-dialog-body space-y-3">
            {failure && (
              <p role="alert" className="text-destructive break-words">
                {failure}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {(['uncommittedChanges', 'baseBranch', 'commit'] as const).map((type) => (
                <Button
                  key={type}
                  size="sm"
                  variant={kind === type ? 'default' : 'outline'}
                  onClick={() => {
                    setKind(type);
                    setRef('');
                  }}
                >
                  {t(
                    type === 'uncommittedChanges'
                      ? 'reviewUncommitted'
                      : type === 'baseBranch'
                        ? 'reviewBranch'
                        : 'reviewCommit',
                  )}
                </Button>
              ))}
            </div>
            {kind !== 'uncommittedChanges' && (
              <Input
                aria-label={t('reviewRef')}
                placeholder={t('reviewRef')}
                value={ref}
                onChange={(e) => setRef(e.target.value)}
              />
            )}
            <Button
              disabled={
                busy ||
                rows.some((r) => r.status === 'running') ||
                (kind !== 'uncommittedChanges' && !ref.trim())
              }
              onClick={start}
            >
              {t('reviewStart')}
            </Button>
            {rows.map((row) => (
              <article key={row.id} className="space-y-2 rounded-lg border p-3">
                <p>
                  {t(
                    row.status === 'running'
                      ? 'reviewRunning'
                      : row.status === 'completed'
                        ? 'reviewCompleted'
                        : row.status === 'cancelled'
                          ? 'reviewCancelled'
                          : row.status === 'unknown'
                            ? 'reviewUnknown'
                            : 'reviewFailed',
                  )}{' '}
                  · {new Date(row.createdAt).toLocaleString()}
                </p>
                <p className="text-xs break-all">
                  {row.target.type}
                  {'branch' in row.target
                    ? `: ${row.target.branch}`
                    : 'sha' in row.target
                      ? `: ${row.target.sha}`
                      : ''}{' '}
                  · {row.nativeId}
                </p>
                {row.status === 'running' && (
                  <Button variant="outline" onClick={() => stop(row.id)}>
                    {t('stop')}
                  </Button>
                )}
                {row.error && <p role="alert">{row.error}</p>}
                <pre className="whitespace-pre-wrap break-words font-sans text-sm">
                  {row.text || (row.status === 'running' ? t('loading') : t('noResults'))}
                </pre>
              </article>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
