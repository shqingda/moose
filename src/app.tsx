import { BackgroundTools, type BackgroundPlacement } from './components/background-tools';
import { WorkspaceTools } from './components/workspace-tools';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { MotionConfig, useReducedMotion } from 'motion/react';
import { ChevronDown, Folder, PanelRight, Search, X, CircleAlert, PanelLeft } from 'lucide-react';
import type {
  Attachment,
  PromptContext,
  Message,
  PermissionMode,
  Provider,
  ProviderInfo,
  Session,
  Settings,
  Snapshot,
} from '../shared/types';
import { LocaleContext, useI18n } from './lib/i18n';
import { useWorkspace } from './lib/workspace';
import { ConfirmDialog, type Confirmation } from './components/confirm-dialog';
import { Sidebar } from './components/sidebar';
import { Welcome } from './components/welcome';
import { Composer } from './components/composer';
const Transcript = lazy(() =>
  import('./components/transcript').then((m) => ({ default: m.Transcript })),
);
const ReviewPanel = lazy(() =>
  import('./components/review-panel').then((m) => ({ default: m.ReviewPanel })),
);
const SettingsDialog = lazy(() =>
  import('./components/settings-dialog').then((m) => ({ default: m.SettingsDialog })),
);
import { IconButton, MooseMark } from './components/common';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Field, FieldLabel } from './components/ui/field';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './components/ui/dialog';
import { Alert, AlertDescription } from './components/ui/alert';
import { TooltipProvider } from './components/ui/tooltip';

/** 应用根入口：加载工作区快照并同步语言、主题和辅助功能设置。 */
export default function App() {
  const workspace = useWorkspace(),
    { snapshot } = workspace;
  const locale =
    snapshot?.settings.language === 'system'
      ? snapshot.locale.startsWith('zh')
        ? 'zh-CN'
        : 'en'
      : snapshot?.settings.language || 'en';
  useEffect(() => {
    if (!snapshot) return;
    const root = document.documentElement;
    root.lang = locale;
    root.classList.toggle(
      'dark',
      snapshot.settings.theme === 'dark' || (snapshot.settings.theme === 'system' && snapshot.dark),
    );
    root.classList.toggle('reduce-motion', snapshot.reduceMotion);
    root.classList.toggle('reduce-transparency', snapshot.reduceTransparency);
    root.classList.toggle('high-contrast', snapshot.highContrast);
    root.style.fontSize = `${15 * snapshot.settings.fontScale}px`;
  }, [snapshot, locale]);
  return (
    <LocaleContext value={locale}>
      <TooltipProvider>
        <MotionConfig reducedMotion={snapshot?.reduceMotion ? 'always' : 'user'}>
          {snapshot ? (
            <Workspace {...workspace} snapshot={snapshot} />
          ) : (
            <div className="boot-screen">
              <MooseMark />
              <span>{workspace.error || 'Opening your workspace…'}</span>
              {workspace.error && (
                <Button
                  onClick={() => {
                    void workspace.refresh();
                  }}
                >
                  Reconnect
                </Button>
              )}
            </div>
          )}
        </MotionConfig>
      </TooltipProvider>
    </LocaleContext>
  );
}
/** 协调项目选择、会话、输入区、审阅与设置，具体展示交给子组件。 */
function Workspace({
  snapshot,
  error,
  setError,
  perform,
  refresh,
}: ReturnType<typeof useWorkspace> & { snapshot: Snapshot }) {
  const t = useI18n(),
    reduceMotion = useReducedMotion();
  const [selected, setSelected] = useState<string | undefined>(
    () => localStorage.getItem('moose.selected') || undefined,
  );
  const [projectId, setProjectId] = useState<string>();
  const [provider, setProvider] = useState<Provider>('codex');
  const [newOptions, setNewOptions] = useState({
    model: '',
    effort: '',
    mode: 'ask' as PermissionMode,
  });
  const [providers, setProviders] = useState<ProviderInfo[]>([]),
    [checking, setChecking] = useState(true);
  // Undefined defers the first load; false keeps dialog state and exit motion after closing.
  const [settingsOpen, setSettingsOpen] = useState<boolean>(),
    [searchOpen, setSearchOpen] = useState(false),
    [search, setSearch] = useState(''),
    [review, setReview] = useState(false),
    [archived, setArchived] = useState(false);
  const [renaming, setRenaming] = useState(false),
    [title, setTitle] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(
    () =>
      localStorage.getItem('moose.sidebar') !== 'hidden' &&
      !(window.moose.host === 'web' && matchMedia('(max-width: 760px)').matches),
  );
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [attachmentDrafts, setAttachmentDrafts] = useState<Record<string, Attachment[]>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dockHost, setDockHost] = useState<HTMLDivElement | null>(null);
  const [dock, setDock] = useState<BackgroundPlacement | null>(null);
  const onDockChange = useCallback((position: BackgroundPlacement | null) => {
    setDock(position);
    if (position === 'right') setReview(false);
  }, []);
  const toolsTrigger = useRef<HTMLButtonElement>(null);
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingDrafts = useRef(new Map<string, string>());
  const session = snapshot.sessions.find((s) => s.id === selected);
  const project =
    snapshot.projects.find((p) => p.id === (session?.projectId || projectId)) ||
    snapshot.projects[0];
  const draftKey = session?.id || `new:${project?.id || ''}`;
  const attachments = attachmentDrafts[draftKey] ?? session?.draftAttachments ?? [];
  /** 切换并持久化侧栏展开状态，不改变当前会话。 */
  const toggleSidebar = () =>
    setSidebarOpen((value) => {
      localStorage.setItem('moose.sidebar', value ? 'hidden' : 'visible');
      return !value;
    });
  /** 把附件选择写入当前会话草稿，或保存在未发送的新会话草稿中。 */
  const onAttachments = (items: Attachment[]) => {
    setAttachmentDrafts((old) => ({ ...old, [draftKey]: items }));
    if (session)
      void perform(() =>
        window.moose.request('updateSession', {
          id: session.id,
          draftAttachments: items.map((a) => a.id),
        }),
      );
  };
  const currentProvider = session?.provider || provider;
  const busy = !!session && ['running', 'waiting', 'queued'].includes(session.status);
  const connect = useCallback(async () => {
    setChecking(true);
    try {
      const info = await window.moose.request('providers', { refresh: true });
      setProviders(info);
    } catch (error) {
      setError(String(error));
    } finally {
      setChecking(false);
    }
  }, [setError]);
  useEffect(() => {
    void connect();
  }, [connect]);
  useEffect(() => {
    if (selected) localStorage.setItem('moose.selected', selected);
    else localStorage.removeItem('moose.selected');
  }, [selected]);
  useEffect(() => {
    const drafts = pendingDrafts.current,
      timers = saveTimers.current;
    const flush = () => {
      for (const [id, draft] of drafts) {
        clearTimeout(timers.get(id));
        void window.moose.request('updateSession', { id, draft }).catch(() => {});
      }
      drafts.clear();
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, []);
  /** 同步输入文本并延迟保存已有会话草稿，避免每个按键都写库。 */
  const onDraft = (draft: string) => {
    setDrafts((old) => ({ ...old, [draftKey]: draft }));
    if (session) {
      const id = session.id;
      clearTimeout(saveTimers.current.get(id));
      pendingDrafts.current.set(id, draft);
      saveTimers.current.set(
        id,
        setTimeout(() => {
          pendingDrafts.current.delete(id);
          void perform(() => window.moose.request('updateSession', { id, draft }));
        }, 250),
      );
    }
  };
  /** 选择已有会话并切换所属项目，退出未保存的新会话视图。 */
  const select = (id: string) => {
    if (window.moose.host === 'web' && matchMedia('(max-width: 760px)').matches)
      setSidebarOpen(false);
    setSelected(id);
    const s = snapshot.sessions.find((s) => s.id === id);
    if (s) {
      setProjectId(s.projectId);
      setArchived(s.archived);
    }
  };
  /** 打开原生目录选择器，将选中的项目设为当前工作区。 */
  const addProject = async () => {
    const p = await perform(() => window.moose.request('addProject', {}));
    if (p) {
      setProjectId(p.id);
      setSelected(undefined);
    }
  };
  /** 进入未保存的新会话输入页，真正发送时才创建数据库记录。 */
  const newSession = async (targetProjectId?: string) => {
    const targetProject = snapshot.projects.find((p) => p.id === targetProjectId) || project;
    if (!targetProject) {
      await addProject();
      return;
    }
    setProvider(currentProvider);
    setNewOptions({
      model: session?.model || '',
      effort: session?.effort || '',
      mode: (session?.mode || 'ask') as PermissionMode,
    });
    setProjectId(targetProject.id);
    setSelected(undefined);
    setArchived(false);
    setDrafts((old) => ({ ...old, [`new:${targetProject.id}`]: '' }));
    setAttachmentDrafts((old) => ({ ...old, [`new:${targetProject.id}`]: [] }));
    requestAnimationFrame(() => document.getElementById('composer')?.focus());
  };
  const command = useRef({ newSession, addProject });
  command.current = { newSession, addProject };
  useEffect(
    () =>
      window.moose.subscribe((event) => {
        if (event.type !== 'command') return;
        if (event.command === 'composer') document.getElementById('composer')?.focus();
        if (event.command === 'sidebar') toggleSidebar();
        if (event.command === 'settings') setSettingsOpen(true);
        if (event.command === 'search') setSearchOpen(true);
        if (event.command === 'open') void command.current.addProject();
        if (event.command === 'review') setReview((value) => !value);
        if (event.command === 'new') void command.current.newSession();
      }),
    [],
  );
  /** 首次发送时创建会话并保存选项，再把输入提交到后台队列。 */
  const onSend = async (context: PromptContext, delivery?: 'steer') => {
    const text = (drafts[draftKey] ?? session?.draft ?? '').trim();
    if (!project || (!text && !attachments.length)) return;
    const target =
      session ||
      (await perform(() =>
        window.moose.request('createSession', { projectId: project.id, provider }),
      ));
    if (!target) return;
    if (
      !session &&
      !(await perform(() =>
        window.moose.request('updateSession', { id: target.id, ...newOptions }),
      ))
    )
      return;
    const args = { sessionId: target.id, text, attachments: attachments.map((a) => a.id), context };
    const item =
      delivery === 'steer'
        ? await (async () => {
            const result = await perform(() =>
              window.moose.request('steer', { ...args, requestId: crypto.randomUUID() }),
            );
            return result?.delivery?.status === 'rejected' ? undefined : result;
          })()
        : await perform(() => window.moose.request('send', args));
    if (item) {
      setAttachmentDrafts((old) => ({ ...old, [draftKey]: [], [target.id]: [] }));
      clearTimeout(saveTimers.current.get(target.id));
      pendingDrafts.current.delete(target.id);
      setDrafts((old) => ({ ...old, [draftKey]: '', [target.id]: '' }));
      await perform(() =>
        window.moose.request('updateSession', {
          id: target.id,
          draft: '',
          draftAttachments: [],
          draftContext: { ...context, references: [], skills: [] },
        }),
      );
      setSelected(target.id);
      return true;
    }
    return false;
  };
  /** 保存配置并刷新快照；代理重连由设置页统一触发，避免重复探测。 */
  const saveSettings = async (settings: Partial<Settings>) => {
    const result = await perform(() => window.moose.request('settings', settings));
    await refresh();
    return result;
  };
  /** 已有会话更新后台配置，新会话先保存界面中的待用选项。 */
  const updateSession = (patch: {
    model?: string;
    effort?: string;
    mode?: PermissionMode;
    archived?: boolean;
  }) => {
    if (session)
      void perform(() => window.moose.request('updateSession', { id: session.id, ...patch }));
    else setNewOptions((old) => ({ ...old, ...patch }));
  };
  /** 确认后归档会话；若归档的是当前会话，切换到未保存的新输入页。 */
  const archiveSession = (target: Session) => {
    if (target.archived) {
      void perform(() => window.moose.request('updateSession', { id: target.id, archived: false }));
      return;
    }
    setConfirmation({
      title: t('confirmArchive'),
      description: t('archiveDescription'),
      action: async () => {
        await window.moose.request('updateSession', { id: target.id, archived: true });
        if (selected === target.id) {
          setProjectId(target.projectId);
          setProvider(target.provider);
          setSelected(undefined);
          setArchived(false);
          setDrafts((old) => ({ ...old, [`new:${target.projectId}`]: '' }));
          setAttachmentDrafts((old) => ({ ...old, [`new:${target.projectId}`]: [] }));
        }
        await refresh();
      },
    });
  };
  /** 确认后删除项目记录及关联会话，保留真实目录文件。 */
  const projectAction = (id: string) =>
    setConfirmation({
      title: t('confirmDelete'),
      description: t('deleteDescription'),
      destructive: true,
      action: async () => {
        await window.moose.request('deleteProject', { projectId: id });
        if (project?.id === id) {
          setSelected(undefined);
          setProjectId(undefined);
        }
        await refresh();
      },
    });
  /** 确认后永久删除归档会话及其本地历史。 */
  const deleteSession = (target: Session) =>
    setConfirmation({
      title: t('confirmDeleteSession'),
      description: t('deleteSessionDescription'),
      destructive: true,
      action: async () => {
        await window.moose.request('deleteSession', { sessionId: target.id });
        if (selected === target.id) setSelected(undefined);
        await refresh();
      },
    });
  /** 提交最新用户消息的修改，仍选中原会话并等待时间线重置。 */
  const editMessage = async (message: Message, text: string) => {
    const next = await window.moose.request('editMessage', {
      sessionId: message.sessionId,
      messageId: message.id,
      text,
    });
    await refresh();
    setSelected(next.id);
    setProjectId(next.projectId);
    setArchived(false);
  };
  /** 通过主进程在 Finder 或系统默认编辑器中打开当前项目。 */
  const openProject = (target: 'finder' | 'editor') => {
    if (project)
      void perform(() =>
        window.moose.request('openProject', {
          projectId: project.id,
          sessionId: session?.id,
          target,
        }),
      );
  };
  const sessions = snapshot.sessions.filter(
    (s) =>
      s.title &&
      `${s.title} ${snapshot.projects.find((p) => p.id === s.projectId)?.name || ''}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <div
      className={`app-shell ${sidebarOpen ? '' : 'sidebar-collapsed'}`}
      data-host={window.moose.host || 'desktop'}
    >
      <div className="global-sidebar-toggle">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('toggleSidebar')}
          onClick={toggleSidebar}
          aria-expanded={sidebarOpen}
        >
          <PanelLeft />
        </Button>
      </div>
      {window.moose.host === 'web' && sidebarOpen && (
        <button
          className="web-sidebar-backdrop"
          aria-label={t('toggleSidebar')}
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <div className="sidebar-frame" inert={!sidebarOpen} aria-hidden={!sidebarOpen}>
        <Sidebar
          onDeleteSession={deleteSession}
          onDeleteProject={projectAction}
          onArchiveSession={archiveSession}
          projects={snapshot.projects}
          sessions={snapshot.sessions}
          selected={selected}
          projectId={project?.id}
          onSelect={select}
          onAdd={() => {
            void addProject();
          }}
          onNew={(id) => {
            void newSession(id);
          }}
          onSettings={() => setSettingsOpen(true)}
          onSearch={() => setSearchOpen(true)}
          archived={archived}
          onArchived={() => setArchived((value) => !value)}
        />
      </div>
      <div className="workspace-stage" data-dock={dock || undefined}>
        <div className="workspace-main">
          <main className="workspace">
            <header className="workspace-header">
              <div className="header-path">
                {project && (
                  <>
                    <Folder size={14} />
                    <span className="header-project" title={project.path}>
                      {project.name}
                    </span>
                  </>
                )}
                {session && (
                  <>
                    <span className="path-divider">/</span>
                    <span className="header-title" title={session.title || t('untitled')}>
                      {session.title || t('untitled')}
                    </span>
                  </>
                )}
              </div>
              <div className="header-actions">
                {project && (
                  <WorkspaceTools
                    trigger={toolsTrigger}
                    key={`${project.id}:${session?.id}:${currentProvider}`}
                    project={project}
                    provider={currentProvider}
                    session={session}
                    busy={busy}
                    onSelect={(target) => {
                      setSelected(target.id);
                      setProjectId(target.projectId);
                      setArchived(target.archived);
                      void refresh();
                    }}
                    onRename={() => {
                      if (session) {
                        setTitle(session.title);
                        setRenaming(true);
                      }
                    }}
                    onArchive={() => {
                      if (session) void archiveSession(session);
                    }}
                    onEditor={() => void openProject('editor')}
                  />
                )}
                {project && (
                  <BackgroundTools
                    reviewOpen={review}
                    dockHost={dockHost}
                    onDockChange={onDockChange}
                    key={`${project.id}:${session?.id}`}
                    scope={{ projectId: project.id, sessionId: session?.id }}
                  />
                )}
                <span className="header-action-divider" />
                <IconButton
                  label={t('review')}
                  onClick={() => setReview((value) => !value)}
                  disabled={!project}
                  aria-pressed={review}
                >
                  <PanelRight />
                </IconButton>
              </div>
            </header>
            {error && (
              <Alert variant="destructive" className="workspace-error">
                <CircleAlert />
                <AlertDescription>{error}</AlertDescription>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('dismiss')}
                  onClick={() => setError('')}
                >
                  <X />
                </Button>
              </Alert>
            )}
            {session?.title ? (
              <Suspense fallback={<div className="transcript" aria-busy="true" />}>
                <Transcript
                  key={`transcript:${session.id}`}
                  session={session}
                  onError={setError}
                  onEdit={editMessage}
                />
              </Suspense>
            ) : (
              <Welcome
                projectName={project?.name}
                onAdd={() => {
                  void addProject();
                }}
              />
            )}
            {project && (
              <Composer
                projectId={project.id}
                attachments={attachments}
                onAttachments={onAttachments}
                key={`composer:${draftKey}`}
                session={session}
                options={session || newOptions}
                provider={currentProvider}
                providers={providers}
                draft={drafts[draftKey] ?? session?.draft ?? ''}
                onDraft={onDraft}
                onProvider={(value) => {
                  setProvider(value);
                  setNewOptions({ model: '', effort: '', mode: 'ask' });
                }}
                onOptions={updateSession}
                onSend={onSend}
                onStop={() => {
                  if (session)
                    void perform(() => window.moose.request('stop', { sessionId: session.id }));
                }}
                onError={setError}
              />
            )}
            {!checking && providers.length > 0 && !providers.some((p) => p.connected) && (
              <button className="connection-banner" onClick={() => setSettingsOpen(true)}>
                {t('noAgent')}
                <ChevronDown size={12} />
              </button>
            )}
          </main>
          {project && (
            <Suspense fallback={null}>
              <ReviewPanel
                open={review}
                key={`${project.id}:${session?.id}`}
                project={project}
                sessionId={session?.id}
                onClose={() => setReview(false)}
                onError={setError}
                reduceMotion={!!reduceMotion || snapshot.reduceMotion}
              />
            </Suspense>
          )}
        </div>
        <div className="workspace-dock" ref={setDockHost} />
      </div>
      <ConfirmDialog
        value={confirmation}
        onClose={() => setConfirmation(undefined)}
        onError={setError}
      />
      <Suspense fallback={null}>
        {settingsOpen !== undefined && (
          <SettingsDialog
            open={!!settingsOpen}
            onOpenChange={setSettingsOpen}
            settings={snapshot.settings}
            providers={providers}
            checking={checking}
            onSave={saveSettings}
            onReconnect={connect}
            onError={setError}
          />
        )}
      </Suspense>
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="search-dialog">
          <DialogHeader>
            <DialogTitle>{t('search')}</DialogTitle>
          </DialogHeader>
          <div className="search-input">
            <Search size={17} />
            <Input
              aria-label={t('search')}
              placeholder={t('search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="search-results">
            {sessions.slice(0, 100).map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  select(s.id);
                  setSearchOpen(false);
                }}
              >
                <span>{s.title || t('untitled')}</span>
                <small>
                  {snapshot.projects.find((p) => p.id === s.projectId)?.name} / {t(s.provider)}
                  {s.archived ? ` / ${t('archived')}` : ''}
                </small>
              </button>
            ))}
            {!sessions.length && <p>{t('noResults')}</p>}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent finalFocus={toolsTrigger}>
          <DialogHeader>
            <DialogTitle>{t('rename')}</DialogTitle>
          </DialogHeader>
          <form
            className="rename-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (session)
                void perform(() =>
                  window.moose.request('updateSession', { id: session.id, title }),
                ).then((result) => {
                  if (result) setRenaming(false);
                });
            }}
          >
            <Field>
              <FieldLabel htmlFor="session-title">{t('sessionTitle')}</FieldLabel>
              <Input
                id="session-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={160}
              />
            </Field>
            <Button type="submit" disabled={!title.trim()}>
              {t('save')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
