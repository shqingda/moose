import { useNotifications } from './lib/notifications';
import type { WorkspaceFileReference } from '../shared/experience';
import { FilePreviewProvider } from './components/file-preview';
import { SearchDialog } from './components/search-dialog';
import { ArchiveUndo } from './components/archive-undo';
import { ErrorNotice } from './components/error-notice';
import { BackgroundTools, type BackgroundPlacement } from './components/background-tools';
import { WorkspaceTools } from './components/workspace-tools';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  MotionConfig,
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionStyle,
} from 'motion/react';
import { ChevronDown, Folder, PanelRight, PanelLeft } from 'lucide-react';
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
const FilesPanel = lazy(() =>
  import('./components/files-panel').then((m) => ({ default: m.FilesPanel })),
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
import { TooltipProvider } from './components/ui/tooltip';

/** 应用根入口：加载工作区快照并同步语言、主题和辅助功能设置。 */
export default function App() {
  const workspace = useWorkspace(),
    { snapshot } = workspace;
  const reportedReady = useRef(false);
  const locale =
    snapshot?.settings.language === 'system'
      ? snapshot.locale.startsWith('zh')
        ? 'zh-CN'
        : 'en'
      : snapshot?.settings.language || (navigator.language.startsWith('zh') ? 'zh-CN' : 'en');
  useLayoutEffect(() => {
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
  useEffect(() => {
    if (
      reportedReady.current ||
      window.moose.host === 'web' ||
      (!snapshot && !workspace.error && !workspace.connection)
    )
      return;
    reportedReady.current = true;
    window.moose.ready();
  }, [snapshot, workspace.error, workspace.connection]);
  return (
    <LocaleContext value={locale}>
      <TooltipProvider>
        <MotionConfig reducedMotion={snapshot?.reduceMotion ? 'always' : 'user'}>
          {snapshot ? (
            <Workspace {...workspace} snapshot={snapshot} />
          ) : (
            <div className="boot-screen">
              <MooseMark />
              <span>
                {workspace.error ||
                  workspace.connection?.message ||
                  (locale === 'zh-CN' ? '正在打开工作区…' : 'Opening your workspace…')}
              </span>
              {(workspace.error || workspace.connection) && (
                <Button
                  onClick={() => {
                    void workspace.refresh();
                  }}
                >
                  {locale === 'zh-CN' ? '重新连接' : 'Reconnect'}
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
  failure,
  connection,
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
    [sidePanel, setSidePanel] = useState<'review' | 'files' | null>(null),
    [archived, setArchived] = useState(false);
  const review = sidePanel === 'review';
  const [filesOpened, setFilesOpened] = useState(false);
  const [fileRequest, setFileRequest] = useState<{
    reference: WorkspaceFileReference;
    nonce: number;
  }>();
  const [renaming, setRenaming] = useState(false),
    [title, setTitle] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(
    () =>
      localStorage.getItem('moose.sidebar') !== 'hidden' &&
      !(window.moose.host === 'web' && matchMedia('(max-width: 760px)').matches),
  );
  const [sidebarParked, setSidebarParked] = useState(() => !sidebarOpen);
  // One interruptible spring keeps the sidebar and toolbar on the same timeline.
  const sidebarProgress = useSpring(sidebarOpen ? 1 : 0, {
    stiffness: 380,
    damping: 39,
    restDelta: 0.0001,
    restSpeed: 0.0001,
  });
  const sidebarWidth = useTransform(sidebarProgress, [0, 1], [0, 264]);
  useLayoutEffect(() => {
    if (sidebarOpen) setSidebarParked(false);
    const target = sidebarOpen ? 1 : 0;
    if (reduceMotion || snapshot.reduceMotion) {
      sidebarProgress.jump(target);
      if (!sidebarOpen) setSidebarParked(true);
    } else sidebarProgress.set(target);
  }, [sidebarOpen, reduceMotion, snapshot.reduceMotion, sidebarProgress]);
  useMotionValueEvent(sidebarProgress, 'animationComplete', () => {
    if (sidebarProgress.get() === 0) setSidebarParked(true);
  });
  const [undoArchive, setUndoArchive] = useState<Session>();
  const [settingsPage, setSettingsPage] = useState<'general' | 'providers'>('general');
  const [targetMessage, setTargetMessage] = useState<string>();
  const attentionTarget = useRef<string | undefined>(undefined);
  const [backgroundReveal, setBackgroundReveal] = useState<{
    terminalId?: string;
    commandId?: string;
    nonce: number;
  }>();
  const [setupProvider, setSetupProvider] = useState<Provider>();
  const openProviders = () => {
    setSetupProvider(currentProvider);
    setSettingsPage('providers');
    setSettingsOpen(true);
  };
  useEffect(() => {
    const open = () => {
      setSettingsPage('providers');
      setSettingsOpen(true);
    };
    window.addEventListener('moose-open-providers', open);
    return () => window.removeEventListener('moose-open-providers', open);
  }, []);
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [attachmentDrafts, setAttachmentDrafts] = useState<Record<string, Attachment[]>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dockHost, setDockHost] = useState<HTMLDivElement | null>(null);
  const [dock, setDock] = useState<BackgroundPlacement | null>(null);
  const onDockChange = useCallback((position: BackgroundPlacement | null) => {
    setDock(position);
    if (position === 'right') setSidePanel(null);
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
  useEffect(() => {
    if (
      attentionTarget.current &&
      targetMessage === attentionTarget.current &&
      snapshot.activities?.[session?.id || '']?.pendingMessageId !== attentionTarget.current
    ) {
      attentionTarget.current = undefined;
      setTargetMessage(undefined);
    }
  }, [snapshot.activities, session?.id, targetMessage]);
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
  const connect = useCallback(async () => {
    setChecking(true);
    try {
      const info = await window.moose.request('providers', { refresh: true });
      setProviders(info);
    } catch (error) {
      setError(error);
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
    attentionTarget.current = snapshot.activities?.[id]?.pendingMessageId;
    setTargetMessage(attentionTarget.current);
    setBackgroundReveal(undefined);
    setSelected(id);
    const s = snapshot.sessions.find((s) => s.id === id);
    if (s) {
      setProjectId(s.projectId);
      setArchived(s.archived);
    }
  };
  useNotifications(session?.id, snapshot.settings, (id, messageId) => {
    select(id);
    if (messageId) setTargetMessage(messageId);
  });
  /** 打开原生目录选择器，将选中的项目设为当前工作区。 */
  const addProject = async () => {
    const p = await perform(() => window.moose.request('addProject', {}));
    if (p) {
      setProjectId(p.id);
      setSelected(undefined);
      setTargetMessage(undefined);
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
    setTargetMessage(undefined);
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
        if (event.command === 'review')
          setSidePanel((value) => (value === 'review' ? null : 'review'));
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
      setTargetMessage(undefined);
      return true;
    }
    return false;
  };
  /** 保存配置并刷新快照；代理重连由设置页统一触发，避免重复探测。 */
  const saveSettings = async (settings: Partial<Settings>) => {
    const result = await window.moose.request('settings', settings);
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
  const archiveSession = (target: Session) => {
    if (target.archived) {
      void perform(() => window.moose.request('updateSession', { id: target.id, archived: false }));
      return;
    }
    const action = async () => {
      await window.moose.request('updateSession', { id: target.id, archived: true });
      if (selected === target.id) {
        setProjectId(target.projectId);
        setProvider(target.provider);
        setSelected(undefined);
        setTargetMessage(undefined);
        setArchived(false);
      }
      setUndoArchive(target);
      await refresh();
    };
    void perform(async () => {
      const queue = await window.moose.request('queue', { sessionId: target.id });
      if (queue.length)
        setConfirmation({ title: t('confirmArchive'), description: t('archiveQueued'), action });
      else await action();
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
    setTargetMessage(undefined);
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
  const revealBlocker = () => {
    const target = snapshot.activities?.[session?.id || '']?.target;
    if (!target) return;
    if (target.sessionId) select(target.sessionId);
    if (target.terminalId || target.commandId)
      setBackgroundReveal({ ...target, nonce: Date.now() });
  };
  return (
    <FilePreviewProvider
      onOpenFile={(reference) => {
        setFileRequest({ reference, nonce: Date.now() });
        setFilesOpened(true);
        setSidePanel('files');
      }}
      scope={project ? { projectId: project.id, sessionId: session?.id } : undefined}
    >
      <motion.div
        className={`app-shell ${sidebarOpen ? '' : 'sidebar-collapsed'}`}
        data-host={window.moose.host || 'desktop'}
        style={{ '--sidebar-expansion': sidebarProgress } as MotionStyle}
      >
        <div className="global-sidebar-toggle">
          <IconButton
            label={t('toggleSidebar')}
            onClick={toggleSidebar}
            aria-expanded={sidebarOpen}
          >
            <PanelLeft />
          </IconButton>
        </div>
        {window.moose.host === 'web' && sidebarOpen && (
          <button
            className="web-sidebar-backdrop"
            aria-label={t('toggleSidebar')}
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <motion.div
          className="sidebar-frame"
          style={{ width: sidebarWidth }}
          data-parked={sidebarParked || undefined}
          inert={!sidebarOpen}
          aria-hidden={!sidebarOpen}
        >
          <Sidebar
            onDeleteSession={deleteSession}
            onDeleteProject={projectAction}
            onArchiveSession={archiveSession}
            projects={snapshot.projects}
            activities={snapshot.activities}
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
        </motion.div>
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
                      onSelect={(target) => {
                        setSelected(target.id);
                        setTargetMessage(undefined);
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
                      runtimeMode={snapshot.runtimeMode}
                      reveal={backgroundReveal}
                      reviewOpen={sidePanel !== null}
                      dockHost={dockHost}
                      onDockChange={onDockChange}
                      key={`${project.id}:${session?.id}`}
                      scope={{ projectId: project.id, sessionId: session?.id }}
                    />
                  )}
                  <span className="header-action-divider" />
                  <IconButton
                    label={t('workspaceFiles')}
                    disabled={!project}
                    aria-pressed={sidePanel === 'files'}
                    onClick={() => {
                      setFilesOpened(true);
                      setSidePanel((value) => (value === 'files' ? null : 'files'));
                    }}
                  >
                    <Folder />
                  </IconButton>
                  <IconButton
                    label={t('review')}
                    onClick={() => setSidePanel((value) => (value === 'review' ? null : 'review'))}
                    disabled={!project}
                    aria-pressed={review}
                  >
                    <PanelRight />
                  </IconButton>
                </div>
              </header>
              {connection && (
                <ErrorNotice
                  value={connection}
                  onReconnect={() => void refresh()}
                  onSettings={openProviders}
                />
              )}
              {failure && (
                <ErrorNotice
                  value={failure}
                  onDismiss={() => setError('')}
                  onReconnect={() => void refresh()}
                  onSettings={openProviders}
                  onBlocker={
                    snapshot.activities?.[session?.id || '']?.target
                      ? () => revealBlocker()
                      : undefined
                  }
                />
              )}
              {session?.title ? (
                <Suspense fallback={<div className="transcript" aria-busy="true" />}>
                  <Transcript
                    key={`transcript:${session.id}:${targetMessage || 'latest'}`}
                    targetMessage={targetMessage}
                    onLatest={() => setTargetMessage(undefined)}
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
              {project &&
                !checking &&
                !providers.some((p) => p.connected && p.enabled !== false) && (
                  <button className="connection-banner" onClick={openProviders}>
                    {t('noAgent')}
                  </button>
                )}
              {session && snapshot.activities?.[session.id]?.reason && (
                <div className="waiting-reason" role="status">
                  <span>{t(`waiting_${snapshot.activities[session.id].reason!}`)}</span>
                  {snapshot.activities[session.id].target && (
                    <Button size="sm" variant="ghost" onClick={revealBlocker}>
                      {t('viewBlocker')}
                    </Button>
                  )}
                  {snapshot.activities[session.id].reason === 'disabled' && (
                    <Button size="sm" variant="ghost" onClick={openProviders}>
                      {t('settings')}
                    </Button>
                  )}
                </div>
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
              {!project &&
                !checking &&
                !providers.some((p) => p.connected && p.enabled !== false) && (
                  <button className="connection-banner" onClick={openProviders}>
                    {t('noAgent')}
                    <ChevronDown size={12} />
                  </button>
                )}
            </main>
            {project && (
              <Suspense fallback={null}>
                {filesOpened && (
                  <FilesPanel
                    key={`files:${project.id}:${session?.id}:${session?.worktreeId}`}
                    open={sidePanel === 'files'}
                    project={project}
                    sessionId={session?.id}
                    request={
                      fileRequest?.reference.projectId === project.id &&
                      fileRequest.reference.sessionId === session?.id
                        ? fileRequest
                        : undefined
                    }
                    onClose={() => setSidePanel(null)}
                    reduceMotion={!!reduceMotion || snapshot.reduceMotion}
                  />
                )}
                <ReviewPanel
                  open={review}
                  key={`${project.id}:${session?.id}`}
                  project={project}
                  sessionId={session?.id}
                  onClose={() => setSidePanel(null)}
                  onError={setError}
                  reduceMotion={!!reduceMotion || snapshot.reduceMotion}
                />
              </Suspense>
            )}
          </div>
          <div className="workspace-dock" ref={setDockHost} />
        </div>
        {undoArchive && (
          <ArchiveUndo
            key={undoArchive.id}
            onClose={() => setUndoArchive(undefined)}
            onError={setError}
            onUndo={async () => {
              await window.moose.request('updateSession', { id: undoArchive.id, archived: false });
              await refresh();
              setSelected(undoArchive.id);
              setProjectId(undoArchive.projectId);
              setArchived(false);
              setTargetMessage(undefined);
            }}
          />
        )}
        <ConfirmDialog
          value={confirmation}
          onClose={() => setConfirmation(undefined)}
          onError={setError}
        />
        <Suspense fallback={null}>
          {settingsOpen !== undefined && (
            <SettingsDialog
              initialPage={settingsPage}
              initialProvider={setupProvider}
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
        <SearchDialog
          open={searchOpen}
          onOpenChange={setSearchOpen}
          projectId={project?.id}
          sessionId={session?.id}
          onSelect={(hit) => {
            select(hit.sessionId);
            setTargetMessage(hit.messageId);
          }}
        />
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
      </motion.div>
    </FilePreviewProvider>
  );
}
