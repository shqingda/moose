import { useCallback, useEffect, useRef, useState } from 'react';
import { MotionConfig, motion, useReducedMotion } from 'motion/react';
import { Archive, ArrowUpRight, ChevronDown, Folder, PanelRight, Pencil, Search, X, CircleAlert, PanelLeft } from 'lucide-react';
import type { Attachment, PromptContext, Message, PermissionMode, Provider, ProviderInfo, Session, Settings, Snapshot } from '../shared/types';
import { LocaleContext, useI18n } from './lib/i18n';
import { useWorkspace } from './lib/workspace';
import { ConfirmDialog, type Confirmation } from './components/confirm-dialog';
import { Sidebar } from './components/sidebar';
import { Welcome } from './components/welcome';
import { Composer } from './components/composer';
import { Transcript } from './components/transcript';
import { ReviewPanel } from './components/review-panel';
import { SettingsDialog } from './components/settings-dialog';
import { IconButton, MooseMark } from './components/common';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Field, FieldLabel } from './components/ui/field';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './components/ui/dialog';
import { Alert, AlertDescription } from './components/ui/alert';
import { TooltipProvider } from './components/ui/tooltip';

export default function App() {
  const workspace = useWorkspace(), { snapshot } = workspace;
  const locale = snapshot?.settings.language === 'system' ? (snapshot.locale.startsWith('zh') ? 'zh-CN' : 'en') : snapshot?.settings.language || 'en';
  useEffect(() => {
    if (!snapshot) return;
    const root = document.documentElement;
    root.lang = locale;
    root.classList.toggle('dark', snapshot.settings.theme === 'dark' || (snapshot.settings.theme === 'system' && snapshot.dark));
    root.classList.toggle('reduce-motion', snapshot.reduceMotion);
    root.classList.toggle('reduce-transparency', snapshot.reduceTransparency);
    root.classList.toggle('high-contrast', snapshot.highContrast);
    root.style.fontSize = `${15 * snapshot.settings.fontScale}px`;
  }, [snapshot, locale]);
  return <LocaleContext value={locale}><TooltipProvider><MotionConfig reducedMotion={snapshot?.reduceMotion ? 'always' : 'user'}>{snapshot ? <Workspace {...workspace} snapshot={snapshot} /> : <div className="boot-screen"><MooseMark /><span>{workspace.error || 'Opening your workspace…'}</span>{workspace.error && <Button onClick={() => { void workspace.refresh(); }}>Reconnect</Button>}</div>}</MotionConfig></TooltipProvider></LocaleContext>;
}
function Workspace({ snapshot, error, setError, perform, refresh }: ReturnType<typeof useWorkspace> & { snapshot: Snapshot }) {
  const t = useI18n(), reduceMotion = useReducedMotion();
  const [selected, setSelected] = useState<string | undefined>(() => localStorage.getItem('moose.selected') || undefined);
  const [projectId, setProjectId] = useState<string>();
  const [provider, setProvider] = useState<Provider>('codex');
  const [newOptions, setNewOptions] = useState({ model: '', effort: '', mode: 'ask' as PermissionMode });
  const [providers, setProviders] = useState<ProviderInfo[]>([]), [checking, setChecking] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false), [searchOpen, setSearchOpen] = useState(false), [search, setSearch] = useState(''), [review, setReview] = useState(false), [archived, setArchived] = useState(false);
  const [renaming, setRenaming] = useState(false), [title, setTitle] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('moose.sidebar') !== 'hidden');
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [attachmentDrafts, setAttachmentDrafts] = useState<Record<string, Attachment[]>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingDrafts = useRef(new Map<string, string>());
  const session = snapshot.sessions.find(s => s.id === selected);
  const project = snapshot.projects.find(p => p.id === (session?.projectId || projectId)) || snapshot.projects[0];
  const draftKey = session?.id || `new:${project?.id || ''}`;
  const attachments = attachmentDrafts[draftKey] ?? session?.draftAttachments ?? [];
  const toggleSidebar = () => setSidebarOpen(value => { localStorage.setItem('moose.sidebar', value ? 'hidden' : 'visible'); return !value; });
  const onAttachments = (items: Attachment[]) => { setAttachmentDrafts(old => ({ ...old, [draftKey]: items })); if (session) void perform(() => window.moose.request('updateSession', { id: session.id, draftAttachments: items.map(a => a.id) })); };
  const currentProvider = session?.provider || provider;
  const busy = !!session && ['running', 'waiting', 'queued'].includes(session.status);
  const connect = useCallback(async () => {
    setChecking(true);
    try { const info = await window.moose.request('providers', { refresh: true }); setProviders(info); }
    catch (error) { setError(String(error)); }
    finally { setChecking(false); }
  }, [setError]);
  useEffect(() => { void connect(); }, [connect]);
  useEffect(() => { if (selected) localStorage.setItem('moose.selected', selected); else localStorage.removeItem('moose.selected'); }, [selected]);
  useEffect(() => {
    const drafts = pendingDrafts.current, timers = saveTimers.current;
    const flush = () => { for (const [id, draft] of drafts) { clearTimeout(timers.get(id)); void window.moose.request('updateSession', { id, draft }).catch(() => {}); } drafts.clear(); };
    window.addEventListener('beforeunload', flush);
    return () => { window.removeEventListener('beforeunload', flush); flush(); };
  }, []);
  const onDraft = (draft: string) => {
    setDrafts(old => ({ ...old, [draftKey]: draft }));
    if (session) {
      const id = session.id; clearTimeout(saveTimers.current.get(id)); pendingDrafts.current.set(id, draft);
      saveTimers.current.set(id, setTimeout(() => { pendingDrafts.current.delete(id); void perform(() => window.moose.request('updateSession', { id, draft })); }, 250));
    }
  };
  const select = (id: string) => { setSelected(id); const s = snapshot.sessions.find(s => s.id === id); if (s) { setProjectId(s.projectId); setArchived(s.archived); } };
  const addProject = async () => { const p = await perform(() => window.moose.request('addProject', {})); if (p) { setProjectId(p.id); setSelected(undefined); } };
  const newSession = async (targetProjectId?: string) => {
    const targetProject = snapshot.projects.find(p => p.id === targetProjectId) || project;
    if (!targetProject) { await addProject(); return; }
    setProvider(currentProvider); setNewOptions({ model: session?.model || '', effort: session?.effort || '', mode: (session?.mode || 'ask') as PermissionMode });
    setProjectId(targetProject.id); setSelected(undefined); setArchived(false);
    setDrafts(old => ({ ...old, [`new:${targetProject.id}`]: '' })); setAttachmentDrafts(old => ({ ...old, [`new:${targetProject.id}`]: [] }));
    requestAnimationFrame(() => document.getElementById('composer')?.focus());
  };
  const command = useRef({ newSession, addProject }); command.current = { newSession, addProject };
  useEffect(() => window.moose.subscribe(event => {
    if (event.type !== 'command') return;
    if (event.command === 'sidebar') toggleSidebar();
    if (event.command === 'settings') setSettingsOpen(true);
    if (event.command === 'search') setSearchOpen(true);
    if (event.command === 'open') void command.current.addProject();
    if (event.command === 'review') setReview(value => !value);
    if (event.command === 'new') void command.current.newSession();
  }), []);
  const onSend = async (context: PromptContext) => {
    const text = (drafts[draftKey] ?? session?.draft ?? '').trim(); if (!project || (!text && !attachments.length)) return;
    const target = session || await perform(() => window.moose.request('createSession', { projectId: project.id, provider }));
    if (!target) return;
    if (!session && !await perform(() => window.moose.request('updateSession', { id: target.id, ...newOptions }))) return;
    const item = await perform(() => window.moose.request('send', { sessionId: target.id, text, attachments: attachments.map(a => a.id), context }));
    if (item) { setAttachmentDrafts(old => ({ ...old, [draftKey]: [], [target.id]: [] })); clearTimeout(saveTimers.current.get(target.id)); pendingDrafts.current.delete(target.id); setDrafts(old => ({ ...old, [draftKey]: '', [target.id]: '' })); await perform(() => window.moose.request('updateSession', { id: target.id, draft: '', draftAttachments: [], draftContext: { ...context, references: [], skills: [] } })); setSelected(target.id); return true; }
    return false;
  };
  const saveSettings = async (settings: Partial<Settings>) => { const result = await perform(() => window.moose.request('settings', settings)); await refresh(); if (settings.codexEnabled !== undefined || settings.grokEnabled !== undefined) await connect(); return result; };
  const updateSession = (patch: { model?: string; effort?: string; mode?: PermissionMode; archived?: boolean }) => { if (session) void perform(() => window.moose.request('updateSession', { id: session.id, ...patch })); else setNewOptions(old => ({ ...old, ...patch })); };
  const archiveSession = (target: Session) => {
    if (target.archived) { void perform(() => window.moose.request('updateSession', { id: target.id, archived: false })); return; }
    setConfirmation({ title: t('confirmArchive'), description: t('archiveDescription'), action: async () => { await window.moose.request('updateSession', { id: target.id, archived: true }); if (selected === target.id) { setProjectId(target.projectId); setProvider(target.provider); setSelected(undefined); setArchived(false); setDrafts(old => ({ ...old, [`new:${target.projectId}`]: '' })); setAttachmentDrafts(old => ({ ...old, [`new:${target.projectId}`]: [] })); } await refresh(); } });
  };
  const projectAction = (id: string) => setConfirmation({ title: t('confirmDelete'), description: t('deleteDescription'), destructive: true, action: async () => { await window.moose.request('deleteProject', { projectId: id }); if (project?.id === id) { setSelected(undefined); setProjectId(undefined); } await refresh(); } });
  const deleteSession = (target: Session) => setConfirmation({ title: t('confirmDeleteSession'), description: t('deleteSessionDescription'), destructive: true, action: async () => { await window.moose.request('deleteSession', { sessionId: target.id }); if (selected === target.id) setSelected(undefined); await refresh(); } });
  const editMessage = async (message: Message, text: string) => {
    const next = await window.moose.request('editMessage', { sessionId: message.sessionId, messageId: message.id, text });
    await refresh(); setSelected(next.id); setProjectId(next.projectId); setArchived(false);
  };
  const openProject = (target: 'finder' | 'editor') => { if (project) void perform(() => window.moose.request('openProject', { projectId: project.id, target })); };
  const sessions = snapshot.sessions.filter(s => s.title && `${s.title} ${snapshot.projects.find(p => p.id === s.projectId)?.name || ''}`.toLowerCase().includes(search.toLowerCase()));
  return <div className={`app-shell ${sidebarOpen ? '' : 'sidebar-collapsed'}`}><div className="global-sidebar-toggle"><IconButton label={t('toggleSidebar')} onClick={toggleSidebar} aria-expanded={sidebarOpen}><PanelLeft /></IconButton></div><motion.div className="sidebar-frame" initial={false} animate={{ width: sidebarOpen ? 264 : 0 }} transition={reduceMotion || snapshot.reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 39 }} inert={!sidebarOpen} aria-hidden={!sidebarOpen}><Sidebar onDeleteSession={deleteSession} onDeleteProject={projectAction} onArchiveSession={archiveSession} projects={snapshot.projects} sessions={snapshot.sessions} selected={selected} projectId={project?.id} onSelect={select} onAdd={() => { void addProject(); }} onNew={id => { void newSession(id); }} onSettings={() => setSettingsOpen(true)} onSearch={() => setSearchOpen(true)} archived={archived} onArchived={() => setArchived(value => !value)} /></motion.div>
    <main className="workspace"><header className="workspace-header"><div className="header-path">{project && <><Folder size={14} /><button onClick={() => openProject('finder')}>{project.name}</button></>}{session && <><span className="path-divider">/</span><span className="header-title">{session.title || t('untitled')}</span></>}</div><div className="header-actions">{session && <><IconButton label={t('rename')} onClick={() => { setTitle(session.title); setRenaming(true); }}><Pencil /></IconButton><IconButton label={t(session.archived ? 'restore' : 'archive')} disabled={busy} onClick={() => archiveSession(session)}><Archive /></IconButton></>}<IconButton label={t('editor')} disabled={!project} onClick={() => openProject('editor')}><ArrowUpRight /></IconButton><span className="header-action-divider" /><IconButton label={t('review')} onClick={() => setReview(value => !value)} disabled={!project} aria-pressed={review}><PanelRight /></IconButton></div></header>
      {error && <Alert variant="destructive" className="workspace-error"><CircleAlert /><AlertDescription>{error}</AlertDescription><Button variant="ghost" size="icon-xs" aria-label={t('dismiss')} onClick={() => setError('')}><X /></Button></Alert>}
      {session?.title ? <Transcript key={`transcript:${session.id}`} session={session} onError={setError} onEdit={editMessage} /> : <Welcome projectName={project?.name} onAdd={() => { void addProject(); }} onPrompt={text => { onDraft(text); document.getElementById('composer')?.focus(); }} />}
      {project && <Composer projectId={project.id} attachments={attachments} onAttachments={onAttachments} key={`composer:${draftKey}`} session={session} options={session || newOptions} provider={currentProvider} providers={providers} draft={drafts[draftKey] ?? session?.draft ?? ''} onDraft={onDraft} onProvider={value => { setProvider(value); setNewOptions({ model: '', effort: '', mode: 'ask' }); }} onOptions={updateSession} onSend={onSend} onStop={() => { if (session) void perform(() => window.moose.request('stop', { sessionId: session.id })); }} onError={setError} />}
      {!checking && providers.length > 0 && !providers.some(p => p.connected) && <button className="connection-banner" onClick={() => setSettingsOpen(true)}>{t('noAgent')}<ChevronDown size={12} /></button>}
    </main>
    {project && <ReviewPanel open={review} key={project.id} project={project} onClose={() => setReview(false)} onError={setError} reduceMotion={!!reduceMotion || snapshot.reduceMotion} />}
    <ConfirmDialog value={confirmation} onClose={() => setConfirmation(undefined)} onError={setError} />
    <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} settings={snapshot.settings} providers={providers} checking={checking} onSave={saveSettings} onReconnect={connect} onError={setError} />
    <Dialog open={searchOpen} onOpenChange={setSearchOpen}><DialogContent className="search-dialog"><DialogHeader><DialogTitle>{t('search')}</DialogTitle></DialogHeader><div className="search-input"><Search size={17} /><Input aria-label={t('search')} placeholder={t('search')} value={search} onChange={e => setSearch(e.target.value)} /></div><div className="search-results">{sessions.slice(0, 100).map(s => <button key={s.id} onClick={() => { select(s.id); setSearchOpen(false); }}><span>{s.title || t('untitled')}</span><small>{snapshot.projects.find(p => p.id === s.projectId)?.name} / {t(s.provider)}{s.archived ? ` / ${t('archived')}` : ''}</small></button>)}{!sessions.length && <p>{t('noResults')}</p>}</div></DialogContent></Dialog>
    <Dialog open={renaming} onOpenChange={setRenaming}><DialogContent><DialogHeader><DialogTitle>{t('rename')}</DialogTitle></DialogHeader><form className="rename-form" onSubmit={e => { e.preventDefault(); if (session) void perform(() => window.moose.request('updateSession', { id: session.id, title })).then(result => { if (result) setRenaming(false); }); }}><Field><FieldLabel htmlFor="session-title">{t('sessionTitle')}</FieldLabel><Input id="session-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={160} /></Field><Button type="submit" disabled={!title.trim()}>{t('save')}</Button></form></DialogContent></Dialog>
  </div>;
}
