import { lazy, Suspense } from 'react';

// Keep the authenticated workspace out of the Web login's static dependency graph.
const App = lazy(() => import('../app'));

export function AppLoader() {
  return (
    <Suspense
      fallback={
        <div className="boot-screen" role="status">
          <span>
            {navigator.language.startsWith('zh') ? '正在打开工作区…' : 'Opening your workspace…'}
          </span>
        </div>
      }
    >
      <App />
    </Suspense>
  );
}
