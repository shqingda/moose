import { Folder, GitBranch } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { Project, Session } from '../../shared/types';
import { useI18n } from '../lib/i18n';

/** Stable workspace context; the directory follows the task's actual worktree. */
export function WorkspaceHeader({
  project,
  session,
  children,
  onError,
}: {
  project?: Project;
  session?: Session;
  children: ReactNode;
  onError(error: unknown): void;
}) {
  const t = useI18n();
  const [directory, setDirectory] = useState<{ id: string; path: string }>();
  useEffect(() => {
    if (!project) return;
    let live = true;
    void window.moose
      .request('workspacePath', { projectId: project.id, sessionId: session?.id })
      .then((path) => {
        if (live) setDirectory({ id: session?.worktreeId || project.id, path });
      })
      .catch((error) => {
        if (live) onError(error);
      });
    return () => {
      live = false;
    };
  }, [project?.id, session?.id, session?.worktreeId, onError]);
  const path = session?.worktreeId
    ? directory?.id === session.worktreeId
      ? directory.path
      : undefined
    : project?.path;
  return (
    <header className="workspace-header">
      <div className="header-context">
        <div className="header-path">
          {project && (
            <>
              <Folder size={16} />
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
        {project && (
          <div className="header-directory" title={path}>
            {session?.worktreeId && <GitBranch size={12} />}
            <span>{path || t('loading')}</span>
          </div>
        )}
      </div>
      <div className="header-actions">{children}</div>
    </header>
  );
}
