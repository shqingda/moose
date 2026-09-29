import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  Copy,
  Download,
  FileCode2,
  FolderTree,
  RefreshCw,
  Search,
  Maximize2,
  Minimize2,
  WrapText,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { FilePreview, WorkspaceFileReference } from '../../shared/experience';
import type { Project } from '../../shared/types';
import type { CodeViewState } from './code-preview';
import { fault } from '../../shared/errors';
import { useI18n } from '../lib/i18n';
import { IconButton } from './common';
import { Button } from './ui/button';
import { ErrorNotice } from './error-notice';
import { FileTree } from './file-tree';
import { Markdown } from './markdown';
const CodePreview = lazy(() => import('./code-preview').then((m) => ({ default: m.CodePreview })));
const filename = (path: string) => path.split('/').pop() || path;
function relativeFile(path: string, root: string) {
  if (path.startsWith('file:')) {
    try {
      path = decodeURIComponent(new URL(path).pathname);
    } catch {
      return path;
    }
  }
  if (path.startsWith(`${root}/`)) path = path.slice(root.length + 1);
  if (path.startsWith('/')) return path;
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..' && parts.length && parts.at(-1) !== '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

const clamp = (width: number) =>
  Math.min(Math.max(320, window.innerWidth - 440), Math.max(380, width));
export function FilesPanel({
  open,
  project,
  sessionId,
  request,
  onClose,
  reduceMotion,
}: {
  open: boolean;
  project: Project;
  sessionId?: string;
  request?: { reference: WorkspaceFileReference; nonce: number };
  onClose(): void;
  reduceMotion: boolean;
}) {
  const t = useI18n();
  const [width, setWidth] = useState(() => clamp(window.innerWidth * 0.52));
  const [resizing, setResizing] = useState(false);
  const [workspaceRoot, setWorkspaceRoot] = useState<string>();
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string>();
  const [tree, setTree] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [find, setFind] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [sourceFiles, setSourceFiles] = useState<Set<string>>(() => new Set());
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ path: string; data: FilePreview }>();
  const [error, setError] = useState<ReturnType<typeof fault>>();
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(1);
  const viewStates = useRef(new Map<string, CodeViewState>());
  const panel = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const data = loaded && loaded.path === active ? loaded.data : undefined;
  const markdown = data?.kind === 'text' && /\.(md|markdown|mdown|mkd)$/i.test(active || '');
  const showMarkdown = markdown && !sourceFiles.has(active || '');
  const select = useCallback(
    (input: string) => {
      const path = relativeFile(input, workspaceRoot || project.path);
      setTabs((previous) => (previous.includes(path) ? previous : [...previous, path]));
      setActive(path);
    },
    [workspaceRoot, project.path],
  );
  useEffect(() => {
    let live = true;
    void window.moose
      .request('workspacePath', { projectId: project.id, sessionId })
      .then((path) => {
        if (live) setWorkspaceRoot(path);
      })
      .catch((e) => {
        if (live) setError(fault(e));
      });
    return () => {
      live = false;
    };
  }, [project.id, sessionId]);
  useEffect(() => {
    if (request && workspaceRoot) select(request.reference.path);
  }, [request, workspaceRoot, select]);
  useEffect(() => {
    const resize = () => setWidth((value) => clamp(value));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    if (open) {
      trigger.current = document.activeElement as HTMLElement;
      panel.current?.focus({ preventScroll: true });
    } else {
      setExpanded(false);
      trigger.current?.focus({ preventScroll: true });
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Dialogs and the code viewer's find bar own Escape while they are active.
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      if (event.target instanceof HTMLElement && event.target.closest('.code-preview-editor'))
        return;
      onClose();
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [open, onClose]);
  useEffect(() => {
    if (!open || !active) return;
    let live = true;
    setLoaded(undefined);
    setError(undefined);
    setCopied(false);
    setZoom(1);
    void window.moose
      .request('filePreview', { projectId: project.id, sessionId, path: active })
      .then((value) => {
        if (live) setLoaded({ path: active, data: value });
      })
      .catch((e) => {
        if (live) setError(fault(e));
      });
    return () => {
      live = false;
    };
  }, [open, active, project.id, sessionId, revision]);
  function closeTab(path: string) {
    const index = tabs.indexOf(path);
    const remaining = tabs.filter((tab) => tab !== path);
    setTabs(remaining);
    setSourceFiles((previous) => {
      const next = new Set(previous);
      next.delete(path);
      return next;
    });
    viewStates.current.delete(path);
    if (active === path) setActive(remaining[Math.min(index, remaining.length - 1)]);
  }
  return (
    <motion.div
      className="review-frame files-frame"
      initial={false}
      animate={{ width: open ? width : 0 }}
      transition={
        reduceMotion || resizing ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 39 }
      }
      inert={!open}
      aria-hidden={!open}
      data-expanded={expanded || undefined}
    >
      <aside
        ref={panel}
        tabIndex={-1}
        className="review-panel files-panel"
        style={{ width }}
        aria-label={t('workspaceFiles')}
      >
        {!expanded && (
          <div
            className="resize-handle"
            role="separator"
            aria-label={t('workspaceFiles')}
            aria-orientation="vertical"
            aria-valuemin={320}
            aria-valuemax={Math.max(320, window.innerWidth - 440)}
            aria-valuenow={width}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                setWidth((value) => clamp(value + (e.key === 'ArrowLeft' ? 16 : -16)));
              }
            }}
            onPointerDown={(e) => {
              setResizing(true);
              e.currentTarget.setPointerCapture(e.pointerId);
              e.currentTarget.dataset.startX = String(e.clientX);
              e.currentTarget.dataset.startWidth = String(width);
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                setWidth(
                  clamp(
                    Number(e.currentTarget.dataset.startWidth) +
                      Number(e.currentTarget.dataset.startX) -
                      e.clientX,
                  ),
                );
            }}
            onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
            onLostPointerCapture={() => setResizing(false)}
          />
        )}
        <header className="files-header">
          <div className="file-tabs" role="tablist" aria-label={t('workspaceFiles')}>
            {tabs.length ? (
              tabs.map((path) => (
                <div
                  className="file-tab"
                  data-hover-surface
                  data-active={active === path || undefined}
                  key={path}
                >
                  <button
                    role="tab"
                    aria-selected={active === path}
                    aria-controls="workspace-file-content"
                    title={path}
                    tabIndex={active === path ? 0 : -1}
                    onClick={() => select(path)}
                    onKeyDown={(e) => {
                      if (
                        e.key === 'ArrowLeft' ||
                        e.key === 'ArrowRight' ||
                        e.key === 'Home' ||
                        e.key === 'End'
                      ) {
                        e.preventDefault();
                        const index =
                          e.key === 'Home'
                            ? 0
                            : e.key === 'End'
                              ? tabs.length - 1
                              : (tabs.indexOf(path) +
                                  (e.key === 'ArrowRight' ? 1 : -1) +
                                  tabs.length) %
                                tabs.length;
                        select(tabs[index]);
                        const buttons = e.currentTarget
                          .closest('[role="tablist"]')
                          ?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                        buttons?.[index]?.focus();
                      } else if (e.key === 'Delete') closeTab(path);
                    }}
                  >
                    <FileCode2 size={15} />
                    <span>{filename(path)}</span>
                  </button>
                  <IconButton
                    className="file-tab-close"
                    size="icon-xs"
                    label={`${t('closeFile')} ${filename(path)}`}
                    onClick={() => closeTab(path)}
                  >
                    <X />
                  </IconButton>
                </div>
              ))
            ) : (
              <span className="files-title">{t('workspaceFiles')}</span>
            )}
          </div>
          <IconButton
            label={t(expanded ? 'restoreFilePanel' : 'expandFilePanel')}
            aria-pressed={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <Minimize2 /> : <Maximize2 />}
          </IconButton>
          <IconButton label={t('close')} onClick={onClose}>
            <X />
          </IconButton>
        </header>
        <div className="files-toolbar">
          <div className="file-breadcrumb" title={active || project.path}>
            <span>{project.name}</span>
            {active && (
              <>
                <span>/</span>
                <strong>{active}</strong>
              </>
            )}
          </div>
          <div className="file-toolbar-actions">
            {markdown && active && (
              <Button
                className="file-mode-toggle"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSourceFiles((previous) => {
                    const next = new Set(previous);
                    if (next.has(active)) next.delete(active);
                    else next.add(active);
                    return next;
                  });
                }}
              >
                {t(showMarkdown ? 'viewFileSource' : 'viewFilePreview')}
              </Button>
            )}
            {data?.kind === 'text' && (
              <>
                {!showMarkdown && (
                  <>
                    <IconButton
                      label={t('findInFile')}
                      aria-pressed={find}
                      onClick={() => setFind((value) => !value)}
                    >
                      <Search />
                    </IconButton>
                    <IconButton
                      label={t('wrapCode')}
                      aria-pressed={wrap}
                      onClick={() => setWrap((v) => !v)}
                    >
                      <WrapText />
                    </IconButton>
                  </>
                )}
                <IconButton
                  label={t(copied ? 'copied' : 'copyFileText')}
                  onClick={() =>
                    void window.moose
                      .request('copyText', { text: data.content || '' })
                      .then(() => setCopied(true))
                      .catch((e) => setError(fault(e)))
                  }
                >
                  <Copy />
                </IconButton>
              </>
            )}
            {data?.kind === 'image' && (
              <>
                <IconButton
                  label={t('zoomOut')}
                  disabled={zoom <= 0.5}
                  onClick={() => setZoom((v) => v - 0.25)}
                >
                  <ZoomOut />
                </IconButton>
                <IconButton
                  label={t('zoomIn')}
                  disabled={zoom >= 4}
                  onClick={() => setZoom((v) => v + 0.25)}
                >
                  <ZoomIn />
                </IconButton>
              </>
            )}
            {data && (
              <IconButton
                label={t('download')}
                disabled={saving}
                onClick={() => {
                  if (!active) return;
                  setSaving(true);
                  void window.moose
                    .request('fileDownload', { projectId: project.id, sessionId, path: active })
                    .catch((e) => setError(fault(e)))
                    .finally(() => setSaving(false));
                }}
              >
                <Download />
              </IconButton>
            )}
            <IconButton label={t('refresh')} onClick={() => setRevision((v) => v + 1)}>
              <RefreshCw />
            </IconButton>
            <IconButton
              label={t('fileTree')}
              aria-pressed={tree}
              onClick={() => setTree((v) => !v)}
            >
              <FolderTree />
            </IconButton>
          </div>
        </div>
        <div className="files-body">
          <div
            className="file-content"
            id="workspace-file-content"
            role="tabpanel"
            aria-label={active ? filename(active) : t('preview')}
          >
            {error && (
              <div className="file-content-notice">
                <ErrorNotice value={error} onReconnect={() => setRevision((v) => v + 1)} />
                <Button size="sm" onClick={() => setRevision((v) => v + 1)}>
                  {t('tryAgain')}
                </Button>
              </div>
            )}
            {!active ? (
              <div className="file-empty">
                <FileCode2 size={28} />
                <p>{t('selectFile')}</p>
              </div>
            ) : !data && !error ? (
              <p className="panel-placeholder" role="status">
                {t('loading')}
              </p>
            ) : showMarkdown ? (
              <div className="file-markdown-preview" key={active}>
                <Markdown
                  text={data?.content || ''}
                  basePath={active}
                  onError={(error) => setError(fault(error))}
                />
              </div>
            ) : data?.kind === 'text' ? (
              <Suspense
                fallback={
                  <p className="panel-placeholder" role="status">
                    {t('loading')}
                  </p>
                }
              >
                <CodePreview
                  name={active}
                  content={data.content || ''}
                  wrap={wrap}
                  find={find}
                  onFindChange={setFind}
                  viewStates={viewStates.current}
                />
              </Suspense>
            ) : data?.kind === 'image' ? (
              <div className="file-panel-image">
                <img
                  src={data.content}
                  alt={data.name}
                  style={{ width: `${zoom * 100}%` }}
                  onError={() => setError(fault(new Error(t('previewFailed'))))}
                />
              </div>
            ) : data ? (
              <p className="panel-placeholder">{t('previewUnsupported')}</p>
            ) : null}
            {data?.truncated && (
              <p className="file-content-notice" role="status">
                {t('previewTruncated')}
              </p>
            )}
            {data?.kind === 'text' && (
              <footer className="file-statusbar">
                {t('readOnlyFile')}
                <span>{filename(active || '')}</span>
              </footer>
            )}
          </div>
          {tree && (
            <FileTree
              scope={{ projectId: project.id, sessionId }}
              selected={active}
              onSelect={select}
              revision={revision}
            />
          )}
        </div>
      </aside>
    </motion.div>
  );
}
