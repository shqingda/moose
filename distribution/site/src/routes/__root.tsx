import type { ReactNode } from 'react';
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import '../styles.css';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      {
        name: 'description',
        content: 'Moose 是面向 AI 编程代理的本地工作台，用于统一管理项目、任务、终端与代码变更。',
      },
      { name: 'theme-color', content: '#f4f6f1' },
      { property: 'og:title', content: 'Moose — AI 编程代理工作台' },
      { property: 'og:description', content: '在 macOS 桌面端或本机 Web UI 中统一管理编程代理。' },
      { title: 'Moose — AI 编程代理工作台' },
    ],
    links: [{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
  }),
  component: Root,
});

function Root() {
  return (
    <Document>
      <Outlet />
    </Document>
  );
}

function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
