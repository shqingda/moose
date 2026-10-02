import { useAuxiliaryPanel, PanelResizeHandle } from '../lib/auxiliary-panel';
import { useFiles } from './file-preview';
import { GitCommit } from './git-commit';
import { PullRequestTools } from './pull-request-tools';
import { CodeReviewTools } from './code-review-tools';
import { Button } from './ui/button';
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Check, ChevronRight, FileCode2, GitBranch, RefreshCw, X } from 'lucide-react';
import type { GitDiff, GitFile, GitStatus, Project } from '../../shared/types';
import { useI18n } from '../lib/i18n';
import { diffLines } from '../lib/diff';
import { IconButton } from './common';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from './ui/empty';
/** 按需读取单个文件 diff，展示行号、二进制或截断提示。 */
function FileReview({
  projectId,
  sessionId,
  file,
  revision,
  onError,
  changed,
}: {
  projectId: string;
  sessionId?: string;
  file: GitFile;
  revision: number;
  onError(error: unknown): void;
  changed(): void;
}) {
  const files = useFiles();
  const t = useI18n(),
    [staging, setStaging] = useState(false),
    [open, setOpen] = useState(false),
    [diff, setDiff] = useState<GitDiff>();
  useEffect(() => {
    let live = true;
    if (open) {
      void window.moose
        .request('gitDiff', { projectId, sessionId, path: file.path, area: file.area })
        .then((d) => {
          if (live) setDiff(d);
        })
        .catch((error) => {
          if (live) onError(error);
        });
    }
    return () => {
      live = false;
    };
  }, [projectId, sessionId, file.path, file.area, revision, open, onError]);
  const lines = useMemo(() => diffLines(diff?.text || ''), [diff?.text]);
  return (
    <section className="review-file">
      <div className="review-file-row">
        <button
          className="change-file"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronRight className={open ? 'rotated' : ''} size={16} />
          <FileCode2 size={18} />
          <span title={file.path}>{file.path}</span>
          {diff && !diff.binary ? (
            <span className="diff-counts">
              <b>+{lines.filter((l) => l.kind === 'added').length}</b>
              <em>−{lines.filter((l) => l.kind === 'removed').length}</em>
            </span>
          ) : (
            <span className="file-status">{file.status}</span>
          )}
        </button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`${t('preview')} ${file.path}`}
          onClick={() => files.open({ projectId, sessionId, path: file.path })}
        >
          {t('preview')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={staging}
          className="shrink-0"
          onClick={async () => {
            setStaging(true);
            try {
              await window.moose.request('gitStage', {
                projectId,
                sessionId,
                path: file.path,
                staged: file.area !== 'staged',
              });
              changed();
            } catch (error) {
              onError(error);
            } finally {
              setStaging(false);
            }
          }}
        >
          {t(file.area === 'staged' ? 'gitUnstage' : 'gitStage')}
        </Button>
      </div>
      {open && (
        <div className="diff-container">
          {!diff ? (
            <p className="panel-placeholder">{t('loading')}</p>
          ) : diff.binary ? (
            <p className="panel-placeholder">{t('binary')}</p>
          ) : (
            <>
              <pre className="diff-code">
                {lines.map((line, i) => (
                  <div key={i} className={`diff-${line.kind}`}>
                    <span className="diff-line-no">{line.old}</span>
                    <span className="diff-line-no">{line.next}</span>
                    <span className="diff-sign">
                      {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ''}
                    </span>
                    <span>{line.text || ' '}</span>
                  </div>
                ))}
              </pre>
              {diff.truncated && <p className="review-note">{t('truncated')}</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}
/** 展示项目改动列表，并管理面板宽度、刷新与展开状态。 */
export function ReviewPanel({
  open,
  project,
  sessionId,
  onClose,
  onError,
  reduceMotion,
}: {
  open: boolean;
  project: Project;
  sessionId?: string;
  onClose(): void;
  onError(error: unknown): void;
  reduceMotion: boolean;
}) {
  const { width, resizing, panel, onKeyDown, resize, setResizing } = useAuxiliaryPanel(
    open,
    onClose,
  );
  const t = useI18n(),
    [status, setStatus] = useState<GitStatus>(),
    [refreshKey, setRefreshKey] = useState(0),
    [loading, setLoading] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!open) return;
    let live = true,
      inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      setLoading(true);
      try {
        const next = await window.moose.request('gitStatus', { projectId: project.id, sessionId });
        if (live) {
          setStatus(next);
          setRevision((n) => n + 1);
        }
      } catch (error) {
        if (live) onError(error);
      } finally {
        inFlight = false;
        if (live) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [open, project.id, sessionId, refreshKey, onError]);
  return (
    <motion.div
      className="review-frame"
      initial={false}
      animate={{ width: open ? width : 0 }}
      transition={
        reduceMotion || resizing ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 39 }
      }
      inert={!open}
      aria-hidden={!open}
    >
      <aside
        ref={panel}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="review-panel"
        style={{ width }}
        aria-label={t('changes')}
      >
        <PanelResizeHandle
          label={t('changes')}
          width={width}
          onResize={resize}
          onResizing={setResizing}
        />
        <header className="review-header">
          <span>{t('review')}</span>
          <span className="review-count">{status?.files.length || 0}</span>
          <div className="ml-auto flex gap-1">
            <IconButton
              label={t('refresh')}
              onClick={() => setRefreshKey((key) => key + 1)}
              disabled={loading}
            >
              <RefreshCw />
            </IconButton>
            <IconButton label={t('close')} onClick={onClose}>
              <X />
            </IconButton>
          </div>
        </header>
        <div className="review-context" title={t('changesHint')}>
          <GitBranch size={16} />
          <span>{status?.branch || project.name}</span>
        </div>
        {status?.isRepo && (
          <div className="flex flex-wrap gap-2 border-b p-3">
            <GitCommit
              scope={{ projectId: project.id, sessionId }}
              changed={() => setRefreshKey((key) => key + 1)}
            />
            <PullRequestTools scope={{ projectId: project.id, sessionId }} />
            <CodeReviewTools scope={{ projectId: project.id, sessionId }} />
          </div>
        )}
        {!status ? (
          <p className="panel-placeholder">{t('loading')}</p>
        ) : !status.isRepo || !status.files.length ? (
          <Empty className="review-empty">
            <Check size={25} />
            <EmptyHeader>
              <EmptyTitle>{t(status.isRepo ? 'noChanges' : 'notGit')}</EmptyTitle>
              <EmptyDescription>{status.isRepo && t('noChangesHint')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="review-files-scroll">
            {(['staged', 'unstaged', 'untracked'] as const).map((area) => {
              const files = status.files.filter((f) => f.area === area);
              return files.length ? (
                <section key={area}>
                  <div className="change-group-title">
                    {t(area)}
                    <span>{files.length}</span>
                  </div>
                  {files.map((file) => (
                    <FileReview
                      key={file.path}
                      projectId={project.id}
                      sessionId={sessionId}
                      file={file}
                      revision={revision}
                      changed={() => setRefreshKey((key) => key + 1)}
                      onError={onError}
                    />
                  ))}
                </section>
              ) : null;
            })}
          </div>
        )}
      </aside>
    </motion.div>
  );
}
