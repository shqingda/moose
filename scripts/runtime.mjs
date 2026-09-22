// Local service launcher. Never signal a PID read from a stale file.
import { spawn } from 'node:child_process';
import { access, mkdir, open, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// Standalone installs use their bundled Node; desktop development keeps Electron's ABI.
const runtimeExecutable =
  process.env.MOOSE_NODE_RUNTIME === '1' ? process.execPath : (await import('electron')).default;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = resolve(process.env.MOOSE_WEB_DATA_DIR || join(homedir(), '.moose/web'));
const file = join(data, 'connection.json');
const command = process.argv[2] || 'start';
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const checkVersion = ['web', 'start', 'desktop'].includes(command);
if (command === '--version' || command === '-v') {
  console.log(version);
  process.exit(0);
}
if (command === '--help' || command === '-h') {
  console.log(
    'Usage: moose [web|start|status|stop]\n  web     Start and open the browser (default)\n  start   Start without opening a browser\n  status  Show runtime status\n  stop    Stop the service and its tasks',
  );
  process.exit(0);
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect() {
  const info = await stat(file);
  if (info.mode & 0o077 || (process.getuid && info.uid !== process.getuid()))
    throw new Error('Runtime connection file is not private to this user');
  const config = JSON.parse(await readFile(file, 'utf8'));
  const url = new URL(config.origin);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    typeof config.token !== 'string'
  )
    throw new Error('Invalid runtime connection file');
  if (checkVersion && config.version !== version)
    throw new Error(
      `Moose ${version} cannot use background service ${config.version || 'unknown'}. Run moose stop, then moose to restart after your tasks finish.`,
    );
  const headers = { Origin: url.origin, 'Content-Type': 'application/json' };
  const login = await fetch(url.origin + '/api/login', {
    method: 'POST',
    headers,
    body: JSON.stringify({ token: config.token }),
    redirect: 'error',
    signal: AbortSignal.timeout(2000),
  });
  if (!login.ok) throw new Error('Runtime authentication failed');
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  if (!cookie?.startsWith('moose_session=')) throw new Error('Missing runtime cookie');
  const request = async (method) => {
    const response = await fetch(url.origin + '/api/request', {
      method: 'POST',
      headers: { ...headers, Cookie: cookie },
      body: JSON.stringify({ method, params: {} }),
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Runtime request failed');
    return body.result;
  };
  const status = await request('webRuntimeStatus');
  if (status.data !== (await realpath(data))) throw new Error('Runtime data directory mismatch');
  return { ...config, request, status };
}

async function start() {
  try {
    return await connect();
  } catch (error) {
    // Existing ownership is never bypassed, even if credentials or reachability are broken.
    try {
      await access(join(data, 'server.lock'));
    } catch (missing) {
      if (missing.code !== 'ENOENT') throw missing;
      return await launch();
    }
    throw new Error(
      'A runtime owns this data directory but could not be reached: ' + error.message,
    );
  }
}
async function launch() {
  await access(join(root, 'dist-electron/web-server/web-server.js'));
  await mkdir(data, { recursive: true, mode: 0o700 });
  const logPath = join(data, 'runtime.log');
  const log = await open(logPath, 'a', 0o600);
  await log.chmod(0o600);
  const child = spawn(runtimeExecutable, [join(root, 'dist-electron/web-server/web-server.js')], {
    cwd: root,
    detached: true,
    stdio: ['ignore', log.fd, log.fd],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      MOOSE_WEB_DATA_DIR: data,
      MOOSE_WEB_PORT: process.env.MOOSE_WEB_PORT || '0',
    },
  });
  let failure;
  child.on('error', (error) => {
    failure = error;
  });
  child.unref();
  await log.close();
  for (let attempt = 0; attempt < 60; attempt++) {
    if (failure) throw failure;
    try {
      return await connect();
    } catch {
      /* Startup may not have written credentials yet. */
    }

    await pause(200);
  }
  throw new Error('Runtime did not become ready. See ' + logPath);
}

try {
  if (!['web', 'start', 'status', 'stop', 'desktop'].includes(command))
    throw new Error('Usage: node scripts/runtime.mjs web|start|status|stop|desktop');
  const connection = ['web', 'start', 'desktop'].includes(command)
    ? await start()
    : await connect();
  if (command === 'stop') {
    await connection.request('webStopService');
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        await access(join(data, 'server.lock'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        console.log('Moose runtime stopped.');
        process.exit(0);
      }
      await pause(200);
    }
    throw new Error(
      'Shutdown was requested but is not yet complete. Check ' + join(data, 'runtime.log'),
    );
  } else {
    console.log('Moose runtime: ' + connection.origin);
    console.log('Data: ' + connection.status.data);
    if (['web', 'start', 'desktop'].includes(command)) {
      console.log('Browser: ' + connection.origin + '/#token=' + connection.token);
      const localhost = new URL(connection.origin);
      localhost.hostname = 'localhost';
      console.log('Browser (localhost): ' + localhost.origin + '/#token=' + connection.token);
    }
    await connection.request('webDisconnect');
    if (command === 'web' && process.env.MOOSE_NO_OPEN !== '1') {
      const browserURL = new URL(connection.origin);
      browserURL.hostname = 'localhost';
      browserURL.hash = 'token=' + connection.token;
      const opener = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [browserURL.href], {
        stdio: 'ignore',
        detached: true,
      });
      opener.on('error', () =>
        console.error('Could not open a browser. Use the Browser link above.'),
      );
      opener.unref();
    }
    if (command === 'desktop') {
      const env = { ...process.env, MOOSE_SHARED_RUNTIME_FILE: file };
      delete env.ELECTRON_RUN_AS_NODE;
      const electron = (await import('electron')).default;
      const desktop = spawn(electron, [root], { cwd: root, stdio: 'inherit', env });
      desktop.on('error', (error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
      desktop.on('exit', (code) => {
        process.exitCode = code ?? 1;
      });
      for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => desktop.kill(signal));
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
