// 构建入口：协调 main / preload / 服务 / pty-host 首次完成后启动 Electron，并区分重启与页面重载。
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import electron from 'vite-plugin-electron';
import { fileURLToPath } from 'node:url';
import { rm } from 'node:fs/promises';
import type { ChildProcess } from 'node:child_process';

export default defineConfig(({ command }) => {
  const ready = new Set<string>();
  let started = false;
  let transition = Promise.resolve();
  // runtime (utility process) and web-server (shared service) build together and share MooseService chunks.
  const targets = {
    main: { 'main/main': 'electron/main.ts' },
    preload: { 'preload/preload': 'electron/preload.ts' },
    service: {
      'runtime/runtime': 'electron/runtime.ts',
      'web-server/web-server': 'electron/web-server.ts',
    },
    'pty-host': { 'pty-host/pty-host': 'electron/pty-host.ts' },
  } as const;
  const names = Object.keys(targets) as (keyof typeof targets)[];
  return {
    base: './',
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    plugins: [
      react(),
      tailwind(),
      electron(
        names.map((target) => ({
          entry: targets[target],
          vite: {
            plugins: [
              {
                name: `moose-ready-${target}`,
                config(config) {
                  if (config.build?.lib)
                    config.build.lib.formats = [target === 'preload' ? 'cjs' : 'es'];
                },
                async buildStart() {
                  // Hashed chunks would pile up in the packaged dist-electron; dev keeps old ones for the running app.
                  if (target === 'service' && command === 'build')
                    await rm('dist-electron/chunks', { recursive: true, force: true });
                },
                closeBundle() {
                  ready.add(target);
                },
              },
            ],
            build: {
              outDir: 'dist-electron',
              sourcemap: command === 'serve',
              lib: {
                entry: targets[target],
                formats: [target === 'preload' ? 'cjs' : 'es'],
                fileName: (_format, name) => (target === 'preload' ? `${name}.cjs` : `${name}.js`),
              },
              rolldownOptions: {
                external: ['electron', 'better-sqlite3', 'node-pty'],
                output:
                  target === 'service'
                    ? { chunkFileNames: 'chunks/[name]-[hash].js' }
                    : { codeSplitting: false },
              },
            },
          },
          onstart({ startup, reload }) {
            ready.add(target);
            if (ready.size !== names.length) return;
            transition = transition.then(async () => {
              if (started && target === 'preload') {
                reload();
                return;
              }
              const previous = (process as NodeJS.Process & { electronApp?: ChildProcess })
                .electronApp;
              if (previous && previous.exitCode === null && previous.signalCode === null) {
                previous.removeAllListeners('exit');
                await new Promise<void>((resolve) => {
                  const timer = setTimeout(() => {
                    previous.kill('SIGKILL');
                    resolve();
                  }, 8000);
                  previous.once('exit', () => {
                    clearTimeout(timer);
                    resolve();
                  });
                  previous.kill('SIGTERM');
                });
              }
              await startup(['.']);
              started = true;
            });
            return transition;
          },
        })),
      ),
    ],
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    build: { sourcemap: command === 'serve' },
  };
});
