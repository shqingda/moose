import { restoreError } from '../shared/errors';
// React 渲染入口：加载全局样式，将 App 挂载到宿主页面。
import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './app.css';
// Restore typed failures on the renderer side: contextBridge strips custom Error fields.
if (window.mooseBridge) {
  const bridge = window.mooseBridge;
  window.moose = {
    ...bridge,
    request: async (method, params) => {
      const result = await bridge.request(method, params);
      if (result && typeof result === 'object' && '__mooseError' in result)
        throw restoreError(result.__mooseError);
      return result;
    },
  };
}
const root = createRoot(document.getElementById('root')!);
const zh = navigator.language.startsWith('zh');
root.render(
  <div className="boot-screen" role="status">
    {zh ? '正在打开工作区…' : 'Opening your workspace…'}
  </div>,
);
// Resolve the host before mounting: a desktop launch must not wait for a Suspense fallback.
void (
  window.moose
    ? import('./app').then((module) => module.default)
    : import('./components/web-host').then((module) => module.WebHost)
)
  .then((Host) => {
    performance.mark('moose/renderer/hostLoaded');
    root.render(
      <React.StrictMode>
        <Host />
      </React.StrictMode>,
    );
  })
  .catch(() => {
    root.render(
      <div className="boot-screen" role="alert">
        <p>{zh ? '界面加载失败，请重新加载。' : 'Unable to load the workspace. Please reload.'}</p>
        <button onClick={() => location.reload()}>{zh ? '重新加载' : 'Reload'}</button>
      </div>,
    );
    window.moose?.ready();
  });
