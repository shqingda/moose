import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { SearchHit } from '../../shared/experience';
import { useI18n } from '../lib/i18n';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { IconButton, Picker } from './common';
export function SearchDialog({
  open,
  onOpenChange,
  projectId,
  sessionId,
  onSelect,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  projectId?: string;
  sessionId?: string;
  onSelect(hit: SearchHit): void;
}) {
  const t = useI18n(),
    [query, setQuery] = useState(''),
    [scope, setScope] = useState('all'),
    [hits, setHits] = useState<SearchHit[]>([]),
    [cursor, setCursor] = useState<string>(),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [index, setIndex] = useState(0);
  const generation = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const activeScope =
    (scope === 'session' && !sessionId) || (scope === 'project' && !projectId) ? 'all' : scope;
  async function fetchPage(token: number, next?: string) {
    setLoading(true);
    setError('');
    try {
      const result = await window.moose.request('searchMessages', {
        query,
        ...(activeScope === 'project'
          ? { projectId }
          : activeScope === 'session'
            ? { sessionId }
            : {}),
        cursor: next,
      });
      if (token !== generation.current) return;
      setHits((old) => (next ? [...old, ...result.hits] : result.hits));
      setCursor(result.cursor);
    } catch (e) {
      if (token === generation.current) setError(String(e));
    } finally {
      if (token === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    const token = ++generation.current;
    setHits([]);
    setCursor(undefined);
    setIndex(0);
    if (!open) return;
    setLoading(true);
    const timer = setTimeout(() => void fetchPage(token), 200);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [open, query, activeScope, projectId, sessionId]);
  useEffect(() => {
    if (open) document.getElementById(`search-hit-${index}`)?.scrollIntoView({ block: 'nearest' });
  }, [index, open]);
  const choose = (hit: SearchHit) => {
    onSelect(hit);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="search-dialog" initialFocus={input}>
        <DialogHeader>
          <DialogTitle>{t('search')}</DialogTitle>
        </DialogHeader>
        <Picker
          label={t('searchScope')}
          value={activeScope}
          options={[
            { value: 'all', label: t('searchAll') },
            ...(projectId ? [{ value: 'project', label: t('searchProject') }] : []),
            ...(sessionId ? [{ value: 'session', label: t('searchSession') }] : []),
          ]}
          onChange={setScope}
        />
        <div className="search-field">
          <Input
            ref={input}
            aria-label={t('search')}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded
            aria-controls="search-results"
            aria-activedescendant={hits[index] ? `search-hit-${index}` : undefined}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.max(0, Math.min(hits.length - 1, i + 1)));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              }
              if ((e.ctrlKey || e.metaKey) && (e.key === 'Home' || e.key === 'End')) {
                e.preventDefault();
                setIndex(e.key === 'Home' ? 0 : Math.max(0, hits.length - 1));
              }
              if (e.key === 'Enter' && hits[index]) {
                e.preventDefault();
                choose(hits[index]);
              }
            }}
          />
          {query && (
            <IconButton
              label={t('clearSearch')}
              onClick={() => {
                setQuery('');
                input.current?.focus();
              }}
            >
              <X />
            </IconButton>
          )}
        </div>
        <div
          id="search-results"
          role="listbox"
          tabIndex={-1}
          aria-label={t('search')}
          className="search-results"
          aria-busy={loading}
        >
          {hits.map((hit, i) => (
            <button
              id={`search-hit-${i}`}
              key={`${hit.sessionId}:${hit.messageId || ''}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === index}
              onClick={() => choose(hit)}
              onFocus={() => setIndex(i)}
            >
              <span>{hit.title || t('untitled')}</span>
              <small>
                {hit.project} / {t(hit.provider)}
                {hit.archived ? ` / ${t('archived')}` : ''}
              </small>
              {hit.snippet && <p>{hit.snippet}</p>}
            </button>
          ))}
        </div>
        {loading && <p role="status">{t('searchLoading')}</p>}
        {!loading && !hits.length && !error && <p role="status">{t('noResults')}</p>}
        {error && (
          <p role="alert">
            {error}
            <Button onClick={() => void fetchPage(generation.current)}>{t('tryAgain')}</Button>
          </p>
        )}
        {cursor && (
          <Button disabled={loading} onClick={() => void fetchPage(generation.current, cursor)}>
            {t('loadMore')}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
