import { useState, type RefObject } from 'react';
import {
  Archive,
  ArrowUpRight,
  ChevronDown,
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
import { NativeTools } from './native-tools';
import { WorktreeTools } from './worktree-tools';

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
  const close = (open: boolean) => {
    if (!open) setActive(undefined);
  };
  return (
    <>
      {session?.worktreeId && <Badge variant="outline">Worktree</Badge>}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button ref={trigger} variant="ghost" size="sm" aria-label={t('workspaceTools')} />
          }
        >
          {t('workspaceToolsShort')}
          <ChevronDown data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setActive('history')}>
              <History />
              {t('nativeTools')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setActive('worktrees')}>
              <GitBranch />
              {t('wtTools')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setActive('extensions')}>
              <Puzzle />
              {t('extTitle')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onEditor}>
              <ArrowUpRight />
              {t('editor')}
            </DropdownMenuItem>
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
      <NativeTools
        project={project}
        provider={provider}
        session={session}
        onSelect={onSelect}
        open={active === 'history'}
        onOpenChange={close}
        returnFocus={trigger}
      />
      <WorktreeTools
        project={project}
        provider={provider}
        session={session}
        onSelect={onSelect}
        open={active === 'worktrees'}
        onOpenChange={close}
        returnFocus={trigger}
      />
      <ExtensionTools
        scope={{ projectId: project.id, sessionId: session?.id, provider }}
        open={active === 'extensions'}
        onOpenChange={close}
        returnFocus={trigger}
      />
    </>
  );
}
