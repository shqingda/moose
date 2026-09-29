import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CodeView, type CodeViewOptions, type CodeViewLineSelection } from '@pierre/diffs';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { IconButton } from './common';
import { useI18n } from '../lib/i18n';

export type CodeViewState = {
  top: number;
  left: number;
  selection: CodeViewLineSelection | null;
};

/** Pierre and its Shiki languages are bundled locally, loaded with the file pane. */
export function CodePreview({
  content,
  name,
  wrap,
  find,
  onFindChange,
  viewStates,
}: {
  content: string;
  name: string;
  wrap: boolean;
  find: boolean;
  onFindChange(value: boolean): void;
  viewStates: Map<string, CodeViewState>;
}) {
  const t = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const viewer = useRef<CodeView | null>(null);
  const [query, setQuery] = useState('');
  const [match, setMatch] = useState(0);
  const matches = useMemo(() => {
    if (!query) return [];
    const needle = query.toLocaleLowerCase();
    return content
      .split('\n')
      .flatMap((line, index) => (line.toLocaleLowerCase().includes(needle) ? [index + 1] : []));
  }, [content, query]);
  const options = useRef<CodeViewOptions<undefined, undefined>>({});
  options.current = {
    disableFileHeader: true,
    enableLineSelection: true,
    lineHoverHighlight: 'disabled',
    theme: { light: 'github-light', dark: 'github-dark' },
    themeType: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    preferredHighlighter: 'shiki-js',
    overflow: wrap ? 'wrap' : 'scroll',
  };
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const instance = new CodeView(options.current);
    viewer.current = instance;
    instance.setup(root);
    instance.setItems([{ id: name, type: 'file', file: { name, contents: content } }]);
    const previous = viewStates.get(name);
    if (previous) {
      instance.setSelectedLines(previous.selection);
      instance.scrollTo({ type: 'position', position: previous.top });
      instance.render(true);
      for (const item of instance.getRenderedItems())
        item.instance.setCodeScrollLeft(previous.left);
    }
    const observer = new MutationObserver(() => {
      options.current = {
        ...options.current,
        themeType: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
      };
      instance.setOptions(options.current);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    return () => {
      viewStates.set(name, {
        top: instance.getScrollTop(),
        left: instance.getRenderedItems()[0]?.instance.getCodeScrollLeft() ?? 0,
        selection: instance.getSelectedLines(),
      });
      observer.disconnect();
      instance.cleanUp();
      viewer.current = null;
    };
  }, [name, content, viewStates]);
  useEffect(() => {
    viewer.current?.setOptions(options.current);
  }, [wrap]);
  useEffect(() => {
    if (find) {
      input.current?.focus();
      input.current?.select();
    }
  }, [find]);
  useEffect(() => {
    if (!find || !query) return;
    const line = matches[match % matches.length];
    viewer.current?.setSelectedLines(line ? { id: name, range: { start: line, end: line } } : null);
    if (line)
      viewer.current?.scrollTo({ type: 'line', id: name, lineNumber: line, align: 'center' });
  }, [find, query, matches, match, name]);
  const next = (direction: number) =>
    setMatch((value) =>
      matches.length ? (value + direction + matches.length) % matches.length : 0,
    );
  const closeFind = () => {
    onFindChange(false);
    container.current?.focus();
  };
  return (
    <div
      className="code-preview-editor"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
          event.preventDefault();
          event.stopPropagation();
          onFindChange(true);
          input.current?.focus();
        } else if (event.key === 'Escape' && find) {
          event.preventDefault();
          event.stopPropagation();
          closeFind();
        }
      }}
    >
      {find && (
        <div className="code-find-bar" role="search" aria-label={t('findInFile')}>
          <input
            ref={input}
            aria-label={t('findInFile')}
            placeholder={t('findInFile')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setMatch(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                next(event.shiftKey ? -1 : 1);
              }
            }}
          />
          <span role="status">
            {query ? `${matches.length ? (match % matches.length) + 1 : 0}/${matches.length}` : ''}
          </span>
          <IconButton
            label={t('previousMatchingLine')}
            disabled={!matches.length}
            onClick={() => next(-1)}
          >
            <ArrowUp />
          </IconButton>
          <IconButton
            label={t('nextMatchingLine')}
            disabled={!matches.length}
            onClick={() => next(1)}
          >
            <ArrowDown />
          </IconButton>
          <IconButton label={t('closeFind')} onClick={closeFind}>
            <X />
          </IconButton>
        </div>
      )}
      <div
        ref={container}
        className="pierre-code-view"
        tabIndex={0}
        role="region"
        aria-label={name}
      />
    </div>
  );
}
