// Use the installed Electron Node runtime so native modules keep their tested ABI.
import { spawn } from 'node:child_process';
import electron from 'electron';
const child = spawn(electron, ['dist-electron/web-server/web-server.js'], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
