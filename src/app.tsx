import { WorkspaceHeader } from './components/workspace-header';
import { useWorkspaceLayout } from './lib/workspace-layout';
import { useSessionDrafts } from './lib/session-drafts';
import { useNotifications } from './lib/notifications';
import type { WorkspaceFileReference } from '../shared/experience';
import { FilePreviewProvider } from './components/file-preview';
import { ArchiveUndo } from './components/archive-undo';
import { ErrorNotice } from './components/error-notice';
import { BackgroundTools } from './components/background-tools';
import { WorkspaceTools } from './components/workspace-tools';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MotionConfig, motion, type MotionStyle } from 'motion/react';
import { ChevronDown, Folder, PanelRight, PanelLeft } from 'lucide-react';
import {
  readSelection,
  reconcileSelection,
  selectionsEqual,
  type ComposerSelection,
} from '../shared/selection';
import type {
  PromptContext,
  Message,
  PermissionMode,
  Provider,
  ProviderInfo,
  Session,
  Settings,
  Snapshot,
} from '../shared/types';
import { emptyContext } from '../shared/types';
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
const SearchDialog = lazy(() =>
  import('./components/search-dialog').then((m) => ({ default: m.SearchDialog })),
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
    root.style.fontSize = `${16 * snapshot.settings.fontScale}px`;
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
  const t = useI18n();
  const {
    reduceMotion,
    sidebarOpen,
    setSidebarOpen,
    sidebarParked,
    sidebarProgress,
    sidebarWidth,
    toggleSidebar,
    sidePanel,
    setSidePanel,
    dockHost,
    setDockHost,
    dock,
    onDockChange,
  } = useWorkspaceLayout(snapshot.reduceMotion);
  const [selected, setSelected] = useState<string | undefined>(
    () => localStorage.getItem('moose.selected') || undefined,
  );
  const [projectId, setProjectId] = useState<string>();
  const restored = snapshot.selection ?? readSelection({});
  const [provider, setProvider] = useState<Provider>(restored.provider);
  const [newOptions, setNewOptions] = useState({
    model: restored.model,
    effort: restored.effort,
    mode: restored.mode,
  });
  const [taskMode, setTaskMode] = useState<PromptContext['mode']>(restored.taskMode);
  const selectionRef = useRef<ComposerSelection>(restored);
  const [providers, setProviders] = useState<ProviderInfo[]>([]),
    [checking, setChecking] = useState(true);
  // Undefined defers the first load; false keeps dialog state and exit motion after closing.
  const [settingsOpen, setSettingsOpen] = useState<boolean>(),
    [searchOpen, setSearchOpen] = useState<boolean>(),
    [archived, setArchived] = useState(false);
  const review = sidePanel === 'review';
  const [filesOpened, setFilesOpened] = useState(false);
  const [fileRequest, setFileRequest] = useState<{
    reference: WorkspaceFileReference;
    nonce: number;
  }>();
  const [renaming, setRenaming] = useState(false),
    [title, setTitle] = useState('');
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
  const toolsTrigger = useRef<HTMLButtonElement>(null);
  const focusAfterSend = useRef<string | undefined>(undefined);
  const session = snapshot.sessions.find((s) => s.id === selected);
  useLayoutEffect(() => {
    if (session?.id && focusAfterSend.current === session.id) {
      document.getElementById('composer')?.focus();
      focusAfterSend.current = undefined;
    }
  }, [session?.id]);
  const project =
    snapshot.projects.find((p) => p.id === (session?.projectId || projectId)) ||
    snapshot.projects[0];
  const {
    draftKey,
    attachments,
    drafts,
    setDrafts,
    setAttachmentDrafts,
    onDraft,
    onAttachments,
    consumeDraft,
  } = useSessionDrafts(session, project?.id, perform);
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
  const currentProvider = session?.provider || provider;
  /** 立刻更新界面上的选择，并在后台记下，供下次启动和新会话恢复。 */
  const visibleSelection = (): ComposerSelection =>
    session
      ? readSelection({
          provider: session.provider,
          model: session.model,
          effort: session.effort,
          mode: session.mode,
          taskMode: session.draftContext?.mode || selectionRef.current.taskMode,
        })
      : selectionRef.current;
  const publishSelection = (patch: Partial<ComposerSelection>, persistSession = true) => {
    const next = readSelection({ ...visibleSelection(), ...patch });
    const previous = selectionRef.current;
    selectionRef.current = next;
    if (next.provider !== previous.provider) setProvider(next.provider);
    if (
      next.model !== previous.model ||
      next.effort !== previous.effort ||
      next.mode !== previous.mode
    )
      setNewOptions({ model: next.model, effort: next.effort, mode: next.mode });
    if (next.taskMode !== previous.taskMode) setTaskMode(next.taskMode);
    if (!selectionsEqual(previous, next))
      void window.moose.request('rememberSelection', next).catch(() => undefined);
    if (!session || !persistSession) return;
    const sessionPatch: {
      model?: string;
      effort?: string;
      mode?: PermissionMode;
      draftContext?: PromptContext;
    } = {};
    if (patch.model !== undefined && next.model !== session.model) sessionPatch.model = next.model;
    if (patch.effort !== undefined && next.effort !== session.effort)
      sessionPatch.effort = next.effort;
    if (patch.mode !== undefined && next.mode !== session.mode) sessionPatch.mode = next.mode;
    if (patch.taskMode !== undefined && next.taskMode !== (session.draftContext?.mode || 'build'))
      sessionPatch.draftContext = {
        ...emptyContext,
        ...session.draftContext,
        mode: next.taskMode,
      };
    if (Object.keys(sessionPatch).length)
      void perform(() =>
        window.moose.request('updateSession', { id: session.id, ...sessionPatch }),
      );
  };
  useEffect(() => {
    const blocked = snapshot.unavailableModels || {};
    const known = providers.map((item) => ({
      ...item,
      models: item.models.map((model) =>
        blocked[item.provider]?.includes(model.id) ? { ...model, unavailable: true } : model,
      ),
    }));
    const current = session
      ? readSelection({
          provider: session.provider,
          model: session.model,
          effort: session.effort,
          mode: session.mode,
          taskMode: session.draftContext?.mode,
        })
      : selectionRef.current;
    const next = reconcileSelection(current, known, { lockProvider: !!session });
    if (selectionsEqual(current, next)) return;
    selectionRef.current = next;
    setProvider(next.provider);
    setNewOptions({ model: next.model, effort: next.effort, mode: next.mode });
    setTaskMode(next.taskMode);
    void window.moose.request('rememberSelection', next).catch(() => undefined);
    if (!session) return;
    const sessionPatch: {
      model?: string;
      effort?: string;
      mode?: PermissionMode;
      draftContext?: PromptContext;
    } = {};
    if (next.model !== session.model) sessionPatch.model = next.model;
    if (next.effort !== session.effort) sessionPatch.effort = next.effort;
    if (next.mode !== session.mode && session.mode) sessionPatch.mode = next.mode;
    if (next.taskMode !== (session.draftContext?.mode || 'build') && session.draftContext?.mode)
      sessionPatch.draftContext = { ...session.draftContext, mode: next.taskMode };
    if (Object.keys(sessionPatch).length)
      void perform(() =>
        window.moose.request('updateSession', { id: session.id, ...sessionPatch }),
      );
  }, [
    providers,
    snapshot.unavailableModels,
    session?.id,
    session?.model,
    session?.effort,
    session?.mode,
    session?.provider,
  ]);
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
    if (providers.length && !performance.getEntriesByName('moose/renderer/providersShown').length)
      performance.mark('moose/renderer/providersShown');
  }, [providers]);
  useEffect(() => {
    // 先显示上一轮探测结果，同时立即刷新；刷新结果总是覆盖缓存。
    let probed = false;
    void window.moose.request('providers', { cached: true }).then(
      (info) => {
        if (!probed && info.length) setProviders(info);
      },
      () => undefined,
    );
    void connect().finally(() => (probed = true));
  }, [connect]);
  useEffect(() => {
    if (selected) localStorage.setItem('moose.selected', selected);
    else localStorage.removeItem('moose.selected');
  }, [selected]);
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
    const next = session
      ? readSelection({
          provider: session.provider,
          model: session.model,
          effort: session.effort,
          mode: session.mode,
          taskMode: session.draftContext?.mode,
        })
      : selectionRef.current;
    selectionRef.current = next;
    setProvider(next.provider);
    setNewOptions({ model: next.model, effort: next.effort, mode: next.mode });
    setTaskMode(next.taskMode);
    void window.moose.request('rememberSelection', next).catch(() => undefined);
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
    const sourceFocus = document.activeElement;
    const submittedDraft = drafts[draftKey] ?? session?.draft ?? '';
    const text = submittedDraft.trim();
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
      const remaining = consumeDraft(target.id, submittedDraft, attachments);
      if (
        !session &&
        (document.activeElement === sourceFocus || document.activeElement === document.body)
      )
        focusAfterSend.current = target.id;
      setSelected(target.id);
      setTargetMessage(undefined);
      await perform(() =>
        window.moose.request('updateSession', {
          id: target.id,
          ...remaining,
          ...(!remaining.draft && { draftContext: { ...context, references: [], skills: [] } }),
        }),
      );
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
    if (patch.archived !== undefined && session)
      void perform(() =>
        window.moose.request('updateSession', { id: session.id, archived: patch.archived }),
      );
    const selectionPatch: Partial<ComposerSelection> = {};
    if (patch.model !== undefined) selectionPatch.model = patch.model;
    if (patch.effort !== undefined) selectionPatch.effort = patch.effort;
    if (patch.mode !== undefined) selectionPatch.mode = patch.mode;
    if (Object.keys(selectionPatch).length) publishSelection(selectionPatch);
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
  const editMessage = useCallback(
    async (message: Message, text: string) => {
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
    },
    [refresh],
  );
  const openFile = useCallback(
    (reference: WorkspaceFileReference) => {
      setFileRequest({ reference, nonce: Date.now() });
      setFilesOpened(true);
      setSidePanel('files');
    },
    [setSidePanel],
  );
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
      onOpenFile={openFile}
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
            <main className="workspace" data-empty={!session?.title || undefined}>
              <WorkspaceHeader project={project} session={session} onError={setError}>
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
                    onFinder={() => void openProject('finder')}
                    onEditor={() => void openProject('editor')}
                  />
                )}
              </WorkspaceHeader>
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
                  onProvider={(value) =>
                    publishSelection({ provider: value, model: '', effort: '' })
                  }
                  onOptions={updateSession}
                  taskMode={session?.draftContext?.mode || taskMode}
                  onTaskMode={(mode) => publishSelection({ taskMode: mode }, false)}
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
        <Suspense fallback={null}>
          {searchOpen !== undefined && (
            <SearchDialog
              open={!!searchOpen}
              onOpenChange={setSearchOpen}
              projectId={project?.id}
              sessionId={session?.id}
              onSelect={(hit) => {
                select(hit.sessionId);
                setTargetMessage(hit.messageId);
              }}
            />
          )}
        </Suspense>
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
