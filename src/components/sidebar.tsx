import type { SessionActivity } from '../../shared/experience';
import { Clock, CircleAlert, CirclePause, MessageCircleQuestion } from 'lucide-react';
import { useState } from 'react';
import {
  LoaderCircle,
  Archive,
  Folder,
  Plus,
  SquarePen,
  Search,
  Settings,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import type { Project, Session } from '../../shared/types';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import { IconButton, MooseMark } from './common';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './ui/dropdown-menu';
import { cn } from '../lib/utils';
/** 按项目展示会话，提供新建、归档与删除入口；项目折叠不切换右侧会话。 */
export function Sidebar({
  projects,
  sessions,
  activities,
  selected,
  projectId,
  onSelect,
  onAdd,
  onNew,
  onSettings,
  onSearch,
  archived,
  onArchived,
  onDeleteSession,
  onDeleteProject,
  onArchiveSession,
}: {
  onDeleteSession(session: Session): void;
  onDeleteProject(id: string): void;
  onArchiveSession(session: Session): void;
  activities?: Record<string, SessionActivity>;
  projects: Project[];
  sessions: Session[];
  selected?: string;
  projectId?: string;
  onSelect(id: string): void;
  onAdd(): void;
  onNew(projectId?: string): void;
  onSettings(): void;
  onSearch(): void;
  archived: boolean;
  onArchived(): void;
}) {
  const t = useI18n();
  const web = window.moose.host === 'web';
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('moose.collapsedProjects') || '[]'));
    } catch {
      return new Set();
    }
  });
  /** 切换项目会话列表的折叠状态，并保存到 localStorage。 */
  const toggle = (id: string) =>
    setCollapsed((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem('moose.collapsedProjects', JSON.stringify([...next]));
      return next;
    });
  return (
    <aside className="sidebar" aria-label={t('projects')}>
      {!web && <div className="sidebar-drag" aria-hidden="true" />}
      <div className="brand-row">
        <MooseMark className="brand-mark" />
        <span>Moose</span>
      </div>
      <div className="sidebar-actions">
        <Button variant="ghost" className="justify-start" onClick={() => onNew()}>
          <SquarePen data-icon="inline-start" />
          {t('newSession')}
          {!web && <kbd aria-hidden="true">⌘ N</kbd>}
        </Button>
        <Button variant="ghost" className="justify-start" onClick={onSearch}>
          <Search data-icon="inline-start" />
          {t('search')}
          {!web && <kbd aria-hidden="true">⌘ K</kbd>}
        </Button>
      </div>
      <div className="section-caption">
        <span>{archived ? t('archived') : t('projects')}</span>
        <div className="flex items-center gap-1">
          {!archived && (
            <IconButton
              label={t('addProject')}
              className="project-add-button"
              size="icon-xs"
              onClick={onAdd}
            >
              <Plus />
            </IconButton>
          )}
        </div>
      </div>
      <nav className="project-list">
        {archived && !sessions.some((s) => s.archived) && (
          <p className="sidebar-empty">{t('noArchived')}</p>
        )}
        {projects.map((project) => {
          const items = sessions.filter(
            (s) => s.projectId === project.id && s.archived === archived && (archived || !!s.title),
          );
          if (archived && !items.length) return null;
          return (
            <section className="project-group" key={project.id}>
              <div className="project-heading-row" data-hover-surface>
                <button
                  className={cn('project-heading', projectId === project.id && 'current')}
                  aria-expanded={!collapsed.has(project.id)}
                  onClick={() => toggle(project.id)}
                  title={project.path}
                >
                  <Folder size={15} />
                  <span>{project.name}</span>
                </button>
                {!archived && (
                  <div className="project-row-actions">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="sidebar-row-action"
                            aria-label={`${t('projectActions')} ${project.name}`}
                          />
                        }
                      >
                        <MoreHorizontal />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => onDeleteProject(project.id)}
                        >
                          <Trash2 />
                          {t('deleteProject')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <IconButton
                      className="sidebar-row-action"
                      size="icon-sm"
                      label={`${t('newSession')} · ${project.name}`}
                      onClick={() => onNew(project.id)}
                    >
                      <SquarePen />
                    </IconButton>
                  </div>
                )}
              </div>
              <div className="session-list" hidden={collapsed.has(project.id)}>
                {items.map((session) => (
                  <div key={session.id} className="session-entry" data-hover-surface>
                    <button
                      className={cn('session-row', selected === session.id && 'selected')}
                      onClick={() => onSelect(session.id)}
                      aria-current={selected === session.id ? 'page' : undefined}
                    >
                      <span className="session-row-content">
                        <span className="session-title">{session.title || t('untitled')}</span>
                      </span>
                      {(activities?.[session.id]?.pendingMessageId ||
                        (session.status !== 'idle' && session.status !== 'completed')) &&
                        (() => {
                          const state = activities?.[session.id]?.pendingMessageId
                            ? 'waiting'
                            : session.status;
                          const Icon =
                            state === 'running'
                              ? LoaderCircle
                              : state === 'waiting'
                                ? MessageCircleQuestion
                                : state === 'queued'
                                  ? Clock
                                  : state === 'failed'
                                    ? CircleAlert
                                    : CirclePause;
                          return (
                            <span
                              className="session-status"
                              role="img"
                              aria-label={t(state)}
                              title={t(state)}
                            >
                              <Icon className={state === 'running' ? 'session-spinner' : ''} />
                            </span>
                          );
                        })()}
                    </button>
                    {session.archived ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="session-row-action sidebar-row-action"
                              aria-label={`${t('sessionActions')} ${session.title || t('untitled')}`}
                            />
                          }
                        >
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onClick={() => onArchiveSession(session)}>
                            <Archive />
                            {t(session.archived ? 'restore' : 'archive')}
                          </DropdownMenuItem>
                          {session.archived && (
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => onDeleteSession(session)}
                            >
                              <Trash2 />
                              {t('deleteSession')}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <IconButton
                        className="session-row-action sidebar-row-action"
                        size="icon-sm"
                        label={`${t('archive')} · ${session.title || t('untitled')}`}
                        disabled={['running', 'waiting'].includes(session.status)}
                        onClick={() => onArchiveSession(session)}
                      >
                        <Archive />
                      </IconButton>
                    )}
                  </div>
                ))}
                {items.length === 0 && <p className="project-empty">{t('noSessions')}</p>}
              </div>
            </section>
          );
        })}
      </nav>
      <footer className="sidebar-footer">
        <Button variant="ghost" onClick={onArchived} aria-pressed={archived}>
          <Archive />
          {t('archived')}
        </Button>
        <Button variant="ghost" onClick={onSettings}>
          <Settings />
          {t('settings')}
        </Button>
      </footer>
    </aside>
  );
}
