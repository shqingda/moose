import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
/** 渲染带代码高亮的 Markdown，链接通过受限系统入口打开。 */
export const Markdown = memo(function Markdown({
  text,
  onError,
}: {
  text: string;
  onError(error: string): void;
}) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        skipHtml
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href)
                  void window.moose
                    .request('openExternal', { url: href })
                    .catch((error) => onError(String(error)));
              }}
            >
              {children}
            </a>
          ),
          img: ({ alt }) => <span className="image-placeholder">{alt || 'Image'}</span>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
