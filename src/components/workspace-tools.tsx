import { lazy, Suspense, useState, type RefObject } from 'react';
import {
  Archive,
  ArrowUpRight,
  MoreHorizontal,
  GitBranch,
  History,
  Pencil,
  Puzzle,
} from 'lucide-react';
import type { Project, Provider, Session } from '../../shared/types';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from './ui/dropdown-menu';
import { ExtensionTools } from './extension-tools';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
const NativeTools = lazy(() => import('./native-tools').then((m) => ({ default: m.NativeTools })));
const WorktreeTools = lazy(() =>
  import('./worktree-tools').then((m) => ({ default: m.WorktreeTools })),
);

/** Keep dialogs outside the menu so closing the menu never unmounts their work. */
export function WorkspaceTools({
  trigger,
  project,
  provider,
  session,
  busy,
  onSelect,
  onRename,
  onArchive,
  onEditor,
}: {
  trigger: RefObject<HTMLButtonElement | null>;
  project: Project;
  provider: Provider;
  session?: Session;
  busy: boolean;
  onSelect(session: Session): void;
  onRename(): void;
  onArchive(): void;
  onEditor(): void;
}) {
  const t = useI18n();
  const [active, setActive] = useState<'history' | 'worktrees' | 'extensions'>();
  const [open, setOpen] = useState(false);
  const show = (kind: typeof active) => {
    setActive(kind);
    setOpen(true);
  };
  return (
    <>
      {session?.worktreeId && <Badge variant="outline">Worktree</Badge>}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              ref={trigger}
              variant="ghost"
              size="icon"
              aria-label={t('workspaceTools')}
              title={t('workspaceTools')}
            />
          }
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => show('history')}>
              <History />
              {t('nativeTools')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => show('worktrees')}>
              <GitBranch />
              {t('wtTools')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => show('extensions')}>
              <Puzzle />
              {t('extTitle')}
            </DropdownMenuItem>
            {window.moose.host !== 'web' && (
              <DropdownMenuItem onClick={onEditor}>
                <ArrowUpRight />
                {t('editor')}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          {session && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={onRename}>
                  <Pencil />
                  {t('rename')}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={busy} onClick={onArchive}>
                  <Archive />
                  {t(session.archived ? 'restore' : 'archive')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={open && (active === 'history' || active === 'worktrees')}
        onOpenChange={setOpen}
      >
        <DialogContent className="native-dialog" finalFocus={trigger}>
          <DialogHeader>
            <DialogTitle>{t(active === 'worktrees' ? 'wtTools' : 'nativeTools')}</DialogTitle>
            <DialogDescription>
              {project.name}
              {active === 'history' ? ` · ${t(provider)}` : ''}
            </DialogDescription>
          </DialogHeader>
          <Suspense fallback={<p role="status">{t('loading')}</p>}>
            {open && active === 'history' && (
              <NativeTools
                key={`${project.id}:${provider}:${session?.id}`}
                project={project}
                provider={provider}
                session={session}
                onSelect={(s) => {
                  onSelect(s);
                  setOpen(false);
                }}
              />
            )}
            {open && active === 'worktrees' && (
              <WorktreeTools
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
          </Suspense>
        </DialogContent>
      </Dialog>
      <ExtensionTools
        scope={{ projectId: project.id, sessionId: session?.id, provider }}
        open={open && active === 'extensions'}
        onOpenChange={setOpen}
        returnFocus={trigger}
      />
    </>
  );
}
