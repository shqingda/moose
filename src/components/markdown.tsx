import { memo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { useFiles, LocalImage } from './file-preview';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
function localPath(url: string) {
  const path = url.replace(/#L\d+(?:-L?\d+)?$/, '').replace(/:\d+(?::\d+)?$/, '');
  if (path.startsWith('file:')) return path;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
function CodeBlock({ children, onError }: { children: ReactNode; onError(error: string): void }) {
  const ref = useRef<HTMLPreElement>(null),
    t = useI18n(),
    [copied, setCopied] = useState(false);
  return (
    <div className="code-block">
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          void window.moose
            .request('copyText', { text: ref.current?.textContent || '' })
            .then(() => setCopied(true))
            .catch((e) => onError(String(e)))
        }
      >
        {t(copied ? 'copied' : 'copyCode')}
      </Button>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}
export const Markdown = memo(function Markdown({
  text,
  onError,
}: {
  text: string;
  onError(error: string): void;
}) {
  const files = useFiles(),
    t = useI18n();
  const external = (url: string) =>
    void window.moose.request('openExternal', { url }).catch((e) => onError(String(e)));
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        skipHtml
        urlTransform={(url) =>
          /^(?:https?:|file:)/i.test(url) || !/^\w[\w+.-]*:/.test(url) ? url : ''
        }
        components={{
          pre: ({ children }) => <CodeBlock onError={onError}>{children}</CodeBlock>,
          a: ({ href, children }) => (
            <a
              href={/^https?:\/\//i.test(href || '') ? href : '#'}
              onClick={(e) => {
                e.preventDefault();
                if (!href) return;
                if (/^https?:\/\//i.test(href)) external(href);
                else if (files.scope) files.open({ ...files.scope, path: localPath(href) });
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
              <LocalImage path={localPath(src)} alt={alt} />
            ) : (
              <span>{alt}</span>
            ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
