// React 渲染入口：加载全局样式，将 App 挂载到宿主页面。
import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './app.css';
import App from './app';
import { WebHost } from './components/web-host';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{window.moose ? <App /> : <WebHost />}</React.StrictMode>,
);
