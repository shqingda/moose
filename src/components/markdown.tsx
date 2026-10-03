import {
  Children,
  isValidElement,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { useFiles, LocalImage } from './file-preview';
import { useI18n } from '../lib/i18n';
import { IconButton } from './common';
import { Check, Code2, Copy, WrapText } from 'lucide-react';
function localPath(url: string) {
  const path = url.replace(/#L\d+(?:-L?\d+)?$/, '').replace(/:\d+(?::\d+)?$/, '');
  if (path.startsWith('file:')) return path;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
function CodeBlock({ children, onError }: { children: ReactNode; onError(error: unknown): void }) {
  const ref = useRef<HTMLPreElement>(null),
    t = useI18n(),
    [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const code = Children.toArray(children).find(isValidElement<{ className?: string }>);
  const language = isValidElement<{ className?: string }>(code)
    ? /language-([^\s]+)/.exec(code.props.className || '')?.[1]
    : undefined;
  const names: Record<string, string> = {
    js: 'JavaScript',
    javascript: 'JavaScript',
    ts: 'TypeScript',
    typescript: 'TypeScript',
    jsx: 'JSX',
    tsx: 'TSX',
    py: 'Python',
    python: 'Python',
    sh: 'Shell',
    bash: 'Bash',
    shell: 'Shell',
    json: 'JSON',
    html: 'HTML',
    css: 'CSS',
    sql: 'SQL',
    md: 'Markdown',
    markdown: 'Markdown',
    yaml: 'YAML',
    yml: 'YAML',
  };
  return (
    <div className="code-block" data-wrap={wrap || undefined}>
      <div className="code-block-header">
        <span className="code-block-language">
          <Code2 aria-hidden="true" />
          {language ? names[language] || language : t('codeLabel')}
        </span>
        <div className="code-block-actions">
          <IconButton label={t('wrapCode')} aria-pressed={wrap} onClick={() => setWrap(!wrap)}>
            <WrapText />
          </IconButton>
          <IconButton
            label={t(copied ? 'copied' : 'copyCode')}
            onClick={() =>
              void window.moose
                .request('copyText', { text: ref.current?.textContent || '' })
                .then(() => {
                  setCopied(true);
                  clearTimeout(timer.current);
                  timer.current = setTimeout(() => setCopied(false), 2000);
                })
                .catch((e) => onError(e))
            }
          >
            {copied ? <Check /> : <Copy />}
          </IconButton>
        </div>
        <span className="sr-only" role="status">
          {copied ? t('copied') : ''}
        </span>
      </div>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}
export const Markdown = memo(function Markdown({
  text,
  onError,
  basePath,
}: {
  text: string;
  onError(error: unknown): void;
  basePath?: string;
}) {
  const files = useFiles(),
    t = useI18n();
  // Stable component types preserve code controls while streamed text changes.
  const components = useMemo<Components>(() => {
    const resolvePath = (url: string) => {
      const path = localPath(url);
      if (!basePath || path.startsWith('/') || path.startsWith('file:')) return path;
      const directory = basePath.slice(0, basePath.lastIndexOf('/') + 1);
      return `${directory}${path}`;
    };
    const external = (url: string) =>
      void window.moose.request('openExternal', { url }).catch((e) => onError(e));
    return {
      pre: ({ children }) => <CodeBlock onError={onError}>{children}</CodeBlock>,
      a: ({ href, children }) => (
        <a
          href={/^https?:\/\//i.test(href || '') ? href : '#'}
          onClick={(e) => {
            e.preventDefault();
            if (!href) return;
            if (/^https?:\/\//i.test(href)) external(href);
            else if (files.scope) files.open({ ...files.scope, path: resolvePath(href) });
          }}
        >
          {children}
        </a>
      ),
      img: ({ src, alt }) =>
        typeof src === 'string' && /^https?:\/\//i.test(src) ? (
          <a
            href={src}
            onClick={(e) => {
              e.preventDefault();
              external(src);
            }}
          >
            {alt || t('externalImage')}
          </a>
        ) : typeof src === 'string' ? (
          <LocalImage path={resolvePath(src)} alt={alt} />
        ) : (
          <span>{alt}</span>
        ),
    };
  }, [basePath, files, onError, t]);
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        skipHtml
        urlTransform={(url) =>
          /^(?:https?:|file:)/i.test(url) || !/^\w[\w+.-]*:/.test(url) ? url : ''
        }
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
