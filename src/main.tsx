import { restoreError } from '../shared/errors';
// React 渲染入口：加载全局样式，将 App 挂载到宿主页面。
import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './app.css';
import { AppLoader } from './components/app-loader';
const WebHost = React.lazy(() =>
  import('./components/web-host').then((m) => ({ default: m.WebHost })),
);
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
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {window.moose ? (
      <AppLoader />
    ) : (
      <React.Suspense fallback={null}>
        <WebHost />
      </React.Suspense>
    )}
  </React.StrictMode>,
);
