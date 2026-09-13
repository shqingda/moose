import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import electron from 'vite-plugin-electron';
import { fileURLToPath } from 'node:url';
import type { ChildProcess } from 'node:child_process';

export default defineConfig(({ command }) => {
  const ready = new Set<string>();
  let started = false;
  let transition = Promise.resolve();
  const targets = ['main', 'preload', 'runtime'] as const;
  return {
    base: './',
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    plugins: [react(), tailwind(), electron(targets.map((target) => ({
      entry: `electron/${target}.ts`,
      vite: {
        plugins: [{ name: `moose-ready-${target}`, config(config) { if (config.build?.lib) config.build.lib.formats = [target === 'preload' ? 'cjs' : 'es']; }, closeBundle() { ready.add(target); } }],
        build: {
          outDir: `dist-electron/${target}`,
          sourcemap: true,
          lib: { entry: `electron/${target}.ts`, formats: [target === 'preload' ? 'cjs' : 'es'], fileName: () => target === 'preload' ? 'preload.cjs' : `${target}.js` },
          rolldownOptions: { external: ['electron', 'better-sqlite3'], output: { codeSplitting: false } },
        },
      },
      onstart({ startup, reload }) {
        ready.add(target);
        if (ready.size !== targets.length) return;
        transition = transition.then(async () => {
          if (started && target === 'preload') { reload(); return; }
          const previous = (process as NodeJS.Process & { electronApp?: ChildProcess }).electronApp;
          if (previous && previous.exitCode === null && previous.signalCode === null) {
            previous.removeAllListeners('exit');
            await new Promise<void>(resolve => {
              const timer = setTimeout(() => { previous.kill('SIGKILL'); resolve(); }, 8000);
              previous.once('exit', () => { clearTimeout(timer); resolve(); });
              previous.kill('SIGTERM');
            });
          }
          await startup(['.']);
          started = true;
        });
        return transition;
      },
    })))],
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    build: { sourcemap: command === 'serve' },
  };
});
