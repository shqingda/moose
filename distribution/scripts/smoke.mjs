import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, mkdir, rm, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const exec = promisify(execFile);
const temporary = await realpath(await mkdtemp(join(tmpdir(), 'moose-install-')));
const publicDir = resolve('distribution/public');
let corrupt = false;
const server = createServer(async (req, res) => {
  try {
    const path = join(publicDir, req.url);
    let bytes = await readFile(path);
    if (corrupt && req.url.startsWith('/latest-')) {
      bytes = Buffer.from(bytes.toString().replace(/[a-f0-9]{64}/, '0'.repeat(64)));
    }
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const env = {
  ...process.env,
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  MOOSE_DOWNLOAD_BASE: process.env.MOOSE_SMOKE_BASE || `http://127.0.0.1:${server.address().port}`,
  MOOSE_INSTALL_DIR: join(temporary, 'install space'),
  MOOSE_BIN_DIR: join(temporary, 'bin'),
  MOOSE_WEB_DATA_DIR: join(temporary, 'data'),
  MOOSE_NO_MODIFY_PATH: '1',
  MOOSE_NO_OPEN: '1',
};
const moose = join(env.MOOSE_BIN_DIR, 'moose');
const run = (...args) => exec(moose, args, { env, timeout: 30000 });
try {
  const installer = join(temporary, 'install.sh');
  await exec('curl', ['-fsSL', env.MOOSE_DOWNLOAD_BASE + '/install.sh', '-o', installer]);
  await exec('/bin/sh', [installer], { env, timeout: 120000 });
  const { version } = JSON.parse(await readFile(new URL('../../package.json', import.meta.url)));
  assert.equal((await run('--version')).stdout.trim(), version);
  await run(); // Default command starts in the background.
  const connection = JSON.parse(await readFile(join(env.MOOSE_WEB_DATA_DIR, 'connection.json')));
  const pid = await readFile(join(env.MOOSE_WEB_DATA_DIR, 'server.lock'), 'utf8');
  await run('start');
  assert.equal(await readFile(join(env.MOOSE_WEB_DATA_DIR, 'server.lock'), 'utf8'), pid);
  assert.match((await run('status')).stdout, /Moose runtime:/);
  const origin = connection.origin.replace('127.0.0.1', 'localhost');
  assert.equal((await fetch(origin)).status, 200);
  const headers = { Origin: origin, 'Content-Type': 'application/json' };
  const login = await fetch(origin + '/api/login', {
    method: 'POST',
    headers,
    body: JSON.stringify({ token: connection.token }),
  });
  assert.equal(login.status, 200);
  headers.Cookie = login.headers.get('set-cookie').split(';')[0];
  const request = async (method, params = {}) => {
    const response = await fetch(origin + '/api/request', {
      method: 'POST',
      headers,
      body: JSON.stringify({ method, params, clientId: '12345678-1234-1234-1234-123456789abc' }),
    });
    const body = await response.json();
    assert.equal(response.status, 200, body.error);
    return body.result;
  };
  await request('snapshot');
  const repo = join(temporary, 'project');
  await mkdir(repo);
  const project = await request('webAddProject', { path: repo });
  const terminal = await request('terminalStart', {
    projectId: project.id,
    requestId: crypto.randomUUID(),
    cols: 80,
    rows: 24,
  });
  await request('terminalInput', { id: terminal.id, text: "printf 'MOOSE_INSTALL_OK\\n'\r" });
  let found = false;
  for (let i = 0; i < 40; i++) {
    const output = await request('terminalRead', { id: terminal.id, offset: 0 });
    if (output.data.includes('MOOSE_INSTALL_OK\r\n')) {
      found = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(found, 'Installed PTY must execute a command');
  // Reinstallation does not stop a running service or lose its data.
  await exec('/bin/sh', [installer], { env, timeout: 120000 });
  assert.equal(await readFile(join(env.MOOSE_WEB_DATA_DIR, 'server.lock'), 'utf8'), pid);
  if (!process.env.MOOSE_SMOKE_BASE) {
    corrupt = true;
    await assert.rejects(
      exec('/bin/sh', [installer], { env, timeout: 120000 }),
      /checksum mismatch/,
    );
    await run('status');
  }
  await run('stop');
  await assert.rejects(stat(join(env.MOOSE_WEB_DATA_DIR, 'server.lock')), { code: 'ENOENT' });
  await run('start');
  const next = JSON.parse(await readFile(join(env.MOOSE_WEB_DATA_DIR, 'connection.json')));
  assert.notEqual(next.token, connection.token);
  // Verify default command invokes the browser opener with localhost authentication.
  const openStub = join(env.MOOSE_BIN_DIR, 'open');
  await writeFile(openStub, '#!/bin/sh\nprintf "%s" "$1" > "$MOOSE_OPEN_CAPTURE"\n', {
    mode: 0o755,
  });
  await exec(moose, [], {
    env: {
      ...env,
      PATH: env.MOOSE_BIN_DIR + ':' + env.PATH,
      MOOSE_NO_OPEN: '0',
      MOOSE_OPEN_CAPTURE: join(temporary, 'opened-url'),
    },
    timeout: 30000,
  });
  for (let i = 0; i < 30; i++) {
    if (await stat(join(temporary, 'opened-url')).catch(() => null)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const opened = new URL(await readFile(join(temporary, 'opened-url'), 'utf8'));
  assert.equal(opened.hostname, 'localhost');
  assert.equal(new URLSearchParams(opened.hash.slice(1)).get('token'), next.token);
  console.log(
    'PASS: clean install without Node on PATH, localhost auth, SQLite, PTY, repeated start, reinstall, checksum rejection (local), stop/restart, browser opening',
  );
} finally {
  await run('stop').catch(() => {});
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
