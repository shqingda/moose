import { useEffect, useState } from 'react';
import { GitBranch } from 'lucide-react';
import type { Project, Provider, Session } from '../../shared/types';
import type { Worktree, WorktreeStatus } from '../../shared/worktrees';
import { useI18n } from '../lib/i18n';
import { IconButton } from './common';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Field, FieldGroup, FieldLabel, FieldDescription } from './ui/field';
import { Alert, AlertDescription } from './ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { ConfirmDialog, type Confirmation } from './confirm-dialog';

export function WorktreeTools({
  project,
  provider,
  session,
  onSelect,
}: {
  project: Project;
  provider: Provider;
  session?: Session;
  onSelect(s: Session): void;
}) {
  const t = useI18n(),
    [open, setOpen] = useState(false);
  return (
    <>
      {session?.worktreeId && <Badge variant="outline">Worktree</Badge>}
      <IconButton label={t('wtTools')} onClick={() => setOpen(true)}>
        <GitBranch />
      </IconButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="native-dialog">
          <DialogHeader>
            <DialogTitle>{t('wtTools')}</DialogTitle>
            <DialogDescription>{project.name}</DialogDescription>
          </DialogHeader>
          {open && (
            <WorktreeContent
              key={project.id}
              project={project}
              provider={provider}
              selectedId={session?.worktreeId || undefined}
              onSelect={(s) => {
                onSelect(s);
                setOpen(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function WorktreeContent({
  project,
  provider,
  selectedId,
  onSelect,
}: {
  project: Project;
  provider: Provider;
  selectedId?: string;
  onSelect(s: Session): void;
}) {
  const t = useI18n();
  const [trees, setTrees] = useState<Worktree[]>([]),
    [status, setStatus] = useState<WorktreeStatus>();
  const [ref, setRef] = useState('HEAD'),
    [branch, setBranch] = useState(() => `moose/task-${crypto.randomUUID().slice(0, 8)}`);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const list = () => window.moose.request('worktreeList', { projectId: project.id });
  const read = (id: string) => window.moose.request('worktreeStatus', { id });
  useEffect(() => {
    let live = true;
    setBusy(true);
    void (async () => {
      const rows = await list();
      const selected = selectedId || rows.find((w) => w.status !== 'removed')?.id;
      const preview = selected ? await read(selected) : undefined;
      if (live) {
        setTrees(rows);
        setStatus(preview);
      }
    })()
      .catch((e) => {
        if (live) setError(String(e));
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [project.id, selectedId]);
  async function act(body: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await body();
      setTrees(await list());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const w = status?.worktree;
  const pending =
    !!w?.merge && ['starting', 'pending', 'conflicts', 'unknown'].includes(w.merge.state);
  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-auto">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {busy && <p role="status">{t('nativeWorking')}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () =>
            onSelect(
              await window.moose.request('worktreeCreate', {
                projectId: project.id,
                provider,
                ref,
                branch,
                requestId: crypto.randomUUID(),
              }),
            ),
          );
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="worktree-ref">{t('wtRef')}</FieldLabel>
            <Input
              id="worktree-ref"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              disabled={busy}
            />
            <FieldDescription>{t('wtCreateHint')}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="worktree-branch">{t('wtBranch')}</FieldLabel>
            <Input
              id="worktree-branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              disabled={busy}
            />
          </Field>
          <Button type="submit" disabled={busy || !ref.trim() || !branch.trim()}>
            {t('wtCreate')}
          </Button>
        </FieldGroup>
      </form>
      <div className="flex flex-col gap-1">
        {trees.map((tree) => (
          <Button
            key={tree.id}
            variant={w?.id === tree.id ? 'secondary' : 'ghost'}
            className="justify-start"
            disabled={busy}
            onClick={() => void act(async () => setStatus(await read(tree.id)))}
          >
            {tree.branch} · {tree.status}
            {tree.kept ? ` · ${t('wtKept')}` : ''}
          </Button>
        ))}
      </div>
      {w && status && (
        <section className="flex flex-col gap-3 rounded-lg border p-3">
          <strong>{w.branch}</strong>
          <code className="break-all text-xs">{w.path}</code>
          <p className="text-sm">
            {t('wtRef')}: {w.baseRef} · {w.baseCommit.slice(0, 12)}
          </p>
          {(status.error || w.error) && (
            <Alert variant="destructive">
              <AlertDescription>{status.error || w.error}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void act(async () => setStatus(await read(w.id)))}
            >
              {t('wtRefresh')}
            </Button>
            <Button
              variant="outline"
              disabled={busy || w.status === 'removed'}
              onClick={() =>
                void act(async () => {
                  await window.moose.request('worktreeKeep', { id: w.id, kept: !w.kept });
                  setStatus(await read(w.id));
                })
              }
            >
              {t(w.kept ? 'wtUnkeep' : 'wtKeep')}
            </Button>
            <Button
              variant="outline"
              disabled={busy || w.kept || pending || w.status === 'removed'}
              onClick={() =>
                setConfirmation({
                  title: t('wtRemove'),
                  description: t('wtRemoveHint'),
                  destructive: true,
                  action: async () => {
                    await window.moose.request('worktreeRemove', { id: w.id });
                    setStatus(await read(w.id));
                    setTrees(await list());
                  },
                })
              }
            >
              {t('wtRemove')}
            </Button>
          </div>
          {w.status === 'ready' && (
            <>
              <p>
                {t('wtTarget')}: <strong>{status.targetBranch}</strong>
              </p>
              <code className="break-all text-xs">{project.path}</code>
              <p className="text-xs">
                {status.sourceCommit.slice(0, 12)} → {status.targetCommit.slice(0, 12)}
              </p>
              {pending && <Badge variant="outline">{w.merge?.state}</Badge>}
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await window.moose.request('openProject', {
                      projectId: project.id,
                      target: 'editor',
                    });
                  })
                }
              >
                {t('wtOpenTarget')}
              </Button>
              {status.merged && !pending && <p>{t('wtMerged')}</p>}
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap text-xs">
                {status.changes || t('wtNoChanges')}
              </pre>
              {status.truncated && <p>{t('truncated')}</p>}
              {!pending && (
                <Button
                  disabled={
                    busy || !!status.error || status.dirty || status.merged || !status.sourceCommit
                  }
                  onClick={() =>
                    void act(async () =>
                      setStatus(
                        await window.moose.request('worktreeMerge', {
                          id: w.id,
                          sourceCommit: status.sourceCommit,
                          targetCommit: status.targetCommit,
                          targetBranch: status.targetBranch,
                        }),
                      ),
                    )
                  }
                >
                  {t('wtMerge')}
                </Button>
              )}
              <FieldDescription>{t('wtMergeHint')}</FieldDescription>
              {pending && (
                <>
                  {status.conflicts.map((path) => (
                    <div className="flex items-center justify-between gap-2" key={path}>
                      <code className="break-all text-xs">{path}</code>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void act(async () =>
                            setStatus(
                              await window.moose.request('worktreeResolve', { id: w.id, path }),
                            ),
                          )
                        }
                      >
                        {t('wtResolve')}
                      </Button>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={
                        busy ||
                        !!status.error ||
                        !!status.conflicts.length ||
                        w.merge?.state !== 'pending'
                      }
                      onClick={() =>
                        void act(async () =>
                          setStatus(
                            await window.moose.request('worktreeComplete', {
                              id: w.id,
                              indexFingerprint: status.indexFingerprint,
                            }),
                          ),
                        )
                      }
                    >
                      {t('wtComplete')}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        setConfirmation({
                          title: t('wtAbort'),
                          description: t('wtAbortHint'),
                          destructive: true,
                          action: async () => {
                            setStatus(await window.moose.request('worktreeAbort', { id: w.id }));
                            setTrees(await list());
                          },
                        })
                      }
                    >
                      {t('wtAbort')}
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      )}
      <ConfirmDialog
        value={confirmation}
        onClose={() => setConfirmation(undefined)}
        onError={setError}
      />
    </div>
  );
}
