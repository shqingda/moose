import { useEffect, useState, type KeyboardEvent } from 'react';
import { ChevronRight, FileCode2, Folder, FolderOpen } from 'lucide-react';
import type { DirectoryEntry, WorkspaceFileReference } from '../../shared/experience';
import { useI18n } from '../lib/i18n';
import { fault } from '../../shared/errors';
import { ErrorNotice } from './error-notice';
import { Button } from './ui/button';
import { Input } from './ui/input';
type Scope = Omit<WorkspaceFileReference, 'path'>;
function Directory({
  scope,
  path,
  depth,
  selected,
  onSelect,
}: {
  scope: Scope;
  path: string;
  depth: number;
  selected?: string;
  onSelect(path: string): void;
}) {
  const t = useI18n();
  const [entries, setEntries] = useState<DirectoryEntry[]>();
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<ReturnType<typeof fault>>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setError(undefined);
    void window.moose
      .request('listDirectory', { ...scope, path })
      .then((result) => {
        if (live) {
          setEntries(result.entries);
          setTruncated(result.truncated);
        }
      })
      .catch((e) => {
        if (live) setError(fault(e));
      });
    return () => {
      live = false;
    };
  }, [scope.projectId, scope.sessionId, path, attempt]);
  return (
    <>
      {error ? (
        <div className="file-tree-notice">
          <ErrorNotice value={error} onReconnect={() => setAttempt((v) => v + 1)} />
          <Button size="sm" onClick={() => setAttempt((v) => v + 1)}>
            {t('tryAgain')}
          </Button>
        </div>
      ) : !entries ? (
        <p className="file-tree-notice" role="status">
          {t('loading')}
        </p>
      ) : entries.length === 0 ? (
        <p className="file-tree-notice">{t('emptyDirectory')}</p>
      ) : (
        entries.map((entry) => (
          <TreeEntry
            key={entry.path}
            entry={entry}
            scope={scope}
            depth={depth}
            selected={selected}
            onSelect={onSelect}
          />
        ))
      )}
      {truncated && <p className="file-tree-notice">{t('directoryTruncated')}</p>}
    </>
  );
}
function TreeEntry({
  entry,
  scope,
  depth,
  selected,
  onSelect,
}: {
  entry: DirectoryEntry;
  scope: Scope;
  depth: number;
  selected?: string;
  onSelect(path: string): void;
}) {
  const containsSelected = !!selected?.startsWith(`${entry.path}/`);
  const [expanded, setExpanded] = useState(containsSelected);
  useEffect(() => {
    if (containsSelected) setExpanded(true);
  }, [containsSelected]);
  const directory = entry.kind === 'directory';
  const Icon = directory ? (expanded ? FolderOpen : Folder) : FileCode2;
  return (
    <div role="none">
      <button
        className="file-tree-row"
        role="treeitem"
        tabIndex={-1}
        aria-level={depth + 1}
        aria-label={entry.name}
        aria-expanded={directory ? expanded : undefined}
        aria-selected={!directory && selected === entry.path}
        title={entry.path}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => (directory ? setExpanded((v) => !v) : onSelect(entry.path))}
      >
        {directory ? (
          <ChevronRight className={expanded ? 'rotated' : ''} size={12} />
        ) : (
          <span className="file-tree-spacer" />
        )}
        <Icon size={15} />
        <span>{entry.name}</span>
      </button>
      {directory && expanded && (
        <div role="group">
          <Directory
            scope={scope}
            path={entry.path}
            depth={depth + 1}
            selected={selected}
            onSelect={onSelect}
          />
        </div>
      )}
    </div>
  );
}
export function FileTree({
  scope,
  selected,
  onSelect,
  revision,
}: {
  scope: Scope;
  selected?: string;
  onSelect(path: string): void;
  revision: number;
}) {
  const t = useI18n();
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DirectoryEntry[]>();
  const [error, setError] = useState<ReturnType<typeof fault>>();
  useEffect(() => {
    let live = true;
    setResults(undefined);
    setError(undefined);
    if (!query.trim()) return;
    const timer = setTimeout(() => {
      void window.moose
        .request('searchFiles', { ...scope, query })
        .then((entries) => {
          if (live)
            setResults(
              entries
                .filter((e) => e.kind === 'file')
                .map((e) => ({ name: e.name, path: e.path, kind: 'file' })),
            );
        })
        .catch((e) => {
          if (live) setError(fault(e));
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [scope.projectId, scope.sessionId, query, revision, attempt]);
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'),
    );
    const current = event.target as HTMLButtonElement;
    const index = items.indexOf(current);
    if (index < 0) return;
    let next: HTMLButtonElement | undefined;
    if (event.key === 'ArrowDown') next = items[index + 1];
    else if (event.key === 'ArrowUp') next = items[index - 1];
    else if (event.key === 'Home') next = items[0];
    else if (event.key === 'End') next = items.at(-1);
    else if (event.key === 'ArrowRight') {
      if (current.getAttribute('aria-expanded') === 'false') current.click();
      else if (current.getAttribute('aria-expanded') === 'true') next = items[index + 1];
    } else if (event.key === 'ArrowLeft') {
      if (current.getAttribute('aria-expanded') === 'true') current.click();
      else
        next = items
          .slice(0, index)
          .reverse()
          .find(
            (item) =>
              Number(item.getAttribute('aria-level')) < Number(current.getAttribute('aria-level')),
          );
    } else return;
    event.preventDefault();
    next?.focus();
  }
  return (
    <nav className="file-tree" aria-label={t('fileTree')}>
      <div className="file-tree-search">
        <Input
          aria-label={t('filterFiles')}
          placeholder={t('filterFiles')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="file-tree-scroll" role="tree" aria-label={t('fileTree')} onKeyDown={navigate}>
        {query.trim() ? (
          error ? (
            <ErrorNotice value={error} onReconnect={() => setAttempt((v) => v + 1)} />
          ) : !results ? (
            <p className="file-tree-notice" role="status">
              {t('loading')}
            </p>
          ) : results.length ? (
            results.map((entry) => (
              <button
                key={entry.path}
                role="treeitem"
                tabIndex={-1}
                aria-level={1}
                className="file-tree-row file-search-result"
                aria-selected={selected === entry.path}
                title={entry.path}
                onClick={() => onSelect(entry.path)}
              >
                <FileCode2 size={15} />
                <span>
                  {entry.name}
                  <small>{entry.path}</small>
                </span>
              </button>
            ))
          ) : (
            <p className="file-tree-notice">{t('noMatchingFiles')}</p>
          )
        ) : (
          <Directory
            key={revision}
            scope={scope}
            path="."
            depth={0}
            selected={selected}
            onSelect={onSelect}
          />
        )}
      </div>
    </nav>
  );
}
