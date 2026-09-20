// React 渲染入口：加载全局样式，将 App 挂载到宿主页面。
import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './app.css';
import App from './app';
const WebHost = React.lazy(() =>
  import('./components/web-host').then((m) => ({ default: m.WebHost })),
);
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {window.moose ? (
      <App />
    ) : (
      <React.Suspense fallback={null}>
        <WebHost />
      </React.Suspense>
    )}
  </React.StrictMode>,
);
