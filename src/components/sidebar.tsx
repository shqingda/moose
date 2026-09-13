import { Archive, Folder, FolderPlus, SquarePen, Search, Settings, Circle, ArrowUpRight, MoreHorizontal, Trash2, PanelLeft } from 'lucide-react';
import type { Project, Session } from '../../shared/types';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import { IconButton, MooseMark } from './common';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/dropdown-menu';
import { cn } from '../lib/utils';
export function Sidebar({ projects, sessions, selected, projectId, onSelect, onProject, onAdd, onNew, onSettings, onSearch, archived, onArchived, onArchiveProject, onDeleteProject, onArchiveSession }: {
  onToggle(): void; onArchiveProject(id: string): void; onDeleteProject(id: string): void; onArchiveSession(session: Session): void;
  projects: Project[]; sessions: Session[]; selected?: string; projectId?: string; onSelect(id: string): void; onProject(id: string): void; onAdd(): void; onNew(): void; onSettings(): void; onSearch(): void; archived: boolean; onArchived(): void;
}) {
  const t = useI18n();
  return <aside className="sidebar" aria-label={t('projects')}>
    <div className="sidebar-drag" />
    <div className="brand-row"><MooseMark className="brand-mark" /><span>Moose</span><IconButton label={t('search')} onClick={onSearch}><Search /></IconButton></div>
    <div className="sidebar-actions"><Button variant="ghost" className="justify-start" onClick={onNew}><SquarePen data-icon="inline-start" />{t('newSession')}<kbd>⌘ N</kbd></Button></div>
    <div className="section-caption"><span>{archived ? t('archived') : t('projects')}</span><IconButton label={t('addProject')} size="icon-xs" onClick={onAdd}><FolderPlus /></IconButton></div>
    <nav className="project-list">
      {projects.map(project => {
        const items = sessions.filter(s => s.projectId === project.id && s.archived === archived);
        return <section className="project-group" key={project.id}><div className="project-heading-row"><button className={cn('project-heading', projectId === project.id && 'current')} onClick={() => onProject(project.id)} title={project.path}><Folder size={15} /><span>{project.name}</span><span className="project-count">{items.length}</span></button><DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`${t('projectActions')} ${project.name}`} />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem onClick={() => onArchiveProject(project.id)}><Archive />{t('archiveProject')}</DropdownMenuItem><DropdownMenuItem variant="destructive" onClick={() => onDeleteProject(project.id)}><Trash2 />{t('deleteProject')}</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
          <div className="session-list">{items.map(session => <div key={session.id} className="session-entry"><button className={cn('session-row', selected === session.id && 'selected')} onClick={() => onSelect(session.id)} aria-current={selected === session.id ? 'page' : undefined}><span className={cn('session-indicator', session.status)} /><span className="session-row-content"><span className="session-title">{session.title || t('untitled')}</span>{['running', 'waiting', 'queued', 'failed', 'interrupted'].includes(session.status) && <span className="session-meta">{t(session.status)}</span>}</span></button><DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`${t('sessionActions')} ${session.title || t('untitled')}`} />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem onClick={() => onArchiveSession(session)}><Archive />{t(session.archived ? 'restore' : 'archive')}</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>)}{items.length === 0 && <p className="project-empty">{t('noSessions')}</p>}</div>
        </section>;
      })}
      {projects.length === 0 && <button className="add-first-project" onClick={onAdd}><FolderPlus size={18} /><span>{t('addProject')}</span><ArrowUpRight size={14} /></button>}
    </nav>
    <footer className="sidebar-footer"><div className="local-label"><Circle size={6} fill="currentColor" />{t('local')}</div><div className="flex items-center gap-1"><IconButton label={t('archived')} onClick={onArchived} aria-pressed={archived}><Archive /></IconButton><IconButton label={t('settings')} onClick={onSettings}><Settings /></IconButton></div></footer>
  </aside>;
}
