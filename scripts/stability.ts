// Fixed isolated workload. Default: two hours. No real model calls or user workspace writes.
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, cp, symlink, readFile, writeFile, stat, readdir, rename } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { platform, arch, release } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Store } from '../electron/db/store';
import { SharedRuntime } from '../electron/shared-runtime';
import type { Method, Requests, Responses } from '../shared/types';
const exec = promisify(execFile);
const minutes = Number(process.env.MOOSE_STABILITY_MINUTES || 120);
if (!Number.isFinite(minutes) || minutes < 1 || minutes > 180)
  throw new Error('Invalid test duration');
const reopenSeconds = Number(process.env.MOOSE_STABILITY_REOPEN_SECONDS || 600);
const reconnectSeconds = Number(process.env.MOOSE_STABILITY_RECONNECT_SECONDS || 60);
if (![reopenSeconds, reconnectSeconds].every((value) => Number.isFinite(value) && value >= 10))
  throw new Error('Invalid lifecycle interval');
const fault = process.env.MOOSE_STABILITY_FAULT;
if (fault && fault !== 'desktop-exit') throw new Error('Unknown diagnostic fault');
const root = resolve('.moose-test', `stability-${Date.now()}`);
const build = join(root, 'build'),
  data = join(root, 'data');
await mkdir(build, { recursive: true });
await mkdir(data);
console.log(`Stability evidence: ${root}`);
for (const entry of ['dist', 'dist-electron', 'dist-native', 'package.json', 'tests/fixtures'])
  await cp(resolve(entry), join(build, entry), { recursive: true });
await symlink(resolve('node_modules'), join(build, 'node_modules'));
const agentPath = join(root, 'agent-project'),
  terminalPath = join(root, 'terminal-project');
await mkdir(agentPath);
await mkdir(terminalPath);
await writeFile(join(agentPath, 'sample.ts'), 'export const ready = true;\n'.repeat(200));
await exec('git', ['init', '-q', agentPath]);
const store = new Store(join(data, 'moose.sqlite'));
store.setSettings({
  language: 'en',
  theme: 'light',
  codexEnabled: true,
  codexPath: join(build, 'tests/fixtures/agent.mjs'),
  grokEnabled: false,
  piEnabled: false,
  opencodeEnabled: false,
});
const project = store.addProject(agentPath),
  terminalProject = store.addProject(terminalPath);
const history = store.createSession(project.id, 'codex'),
  live = store.createSession(project.id, 'codex');
store.updateSession(history.id, {
  title: 'Ten thousand events',
  status: 'completed',
  draft: 'Preserved stability draft',
});
store.updateSession(live.id, { title: 'Continuous output' });
for (let i = 0; i < 10000; i++)
  store.saveMessage({
    id: randomUUID(),
    sessionId: history.id,
    runId: 'history',
    seq: i,
    kind: 'assistant',
    state: 'done',
    title: '',
    text: `Stability needle ${i}. Historical content.`,
    createdAt: i + 1,
  });
store.close();
const env: Record<string, string> = Object.fromEntries(
  Object.entries({
    ...process.env,
    MOOSE_DATA_DIR: data,
    MOOSE_RUNTIME_MODE: 'shared',
    MOOSE_TEST_BACKGROUND: '1',
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
);
delete env.ELECTRON_RUN_AS_NODE;
delete env.MOOSE_SHARED_RUNTIME_FILE;
const client = new SharedRuntime(join(data, 'connection.json'), () => {});
const request = <M extends Method>(method: M, params: Requests[M]) =>
  client.request(method, params) as Promise<Responses[M]>;
let desktop: ElectronApplication | undefined, web: ElectronApplication | undefined;
let desktopPage!: Page,
  webPage!: Page,
  terminalId = '',
  terminalOffset = 0;
const errors: string[] = [];
let phase = 'setup';
const expectedClose = new WeakSet<ElectronApplication>();
const appPids = new WeakMap<ElectronApplication, number>();
const knownProcesses = new Map<number, string>();
const redact = (value: string) => value.replace(/([#?]token=)[^\s"']+/g, '$1[REDACTED]');
function event(kind: string, detail: unknown = {}) {
  appendFileSync(
    join(root, 'events.jsonl'),
    JSON.stringify({
      at: new Date().toISOString(),
      phase,
      kind,
      detail,
    }) + '\n',
  );
}
function stage(value: string) {
  phase = value;
  event('stage');
}
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    event('runner-signal', { signal });
    interrupted = true;
  });
async function hashTree(directory: string, prefix = ''): Promise<[string, string][]> {
  const result: [string, string][] = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const name = join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...(await hashTree(join(directory, entry.name), name)));
    else if (entry.isFile())
      result.push([
        name,
        createHash('sha256')
          .update(await readFile(join(directory, entry.name)))
          .digest('hex'),
      ]);
  }
  return result;
}
const manifest = (
  await Promise.all(
    ['dist', 'dist-electron', 'dist-native', 'tests'].map((entry) =>
      hashTree(join(build, entry), entry),
    ),
  )
).flat();
manifest.push([
  'package.json',
  createHash('sha256')
    .update(await readFile(join(build, 'package.json')))
    .digest('hex'),
]);
await writeFile(join(root, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const sourceDiff = (await exec('git', ['diff', 'HEAD', '--binary'])).stdout;
const report = {
  schemaVersion: 2,
  root,
  host: { platform: platform(), arch: arch(), release: release(), node: process.version },
  source: {
    commit: (await exec('git', ['rev-parse', 'HEAD'])).stdout.trim(),
    dirty: (await exec('git', ['status', '--porcelain'])).stdout.trim().split('\n').filter(Boolean),
    diffHash: createHash('sha256').update(sourceDiff).digest('hex'),
    harnessHash: createHash('sha256')
      .update(await readFile(resolve('scripts/stability.ts')))
      .digest('hex'),
    buildManifestHash: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
  },
  profile:
    minutes >= 120 && reopenSeconds === 600 && reconnectSeconds === 60 && !fault
      ? 'full'
      : 'diagnostic',
  intervals: { reopenSeconds, reconnectSeconds },
  fault: fault || null,
  version: JSON.parse(await readFile(join(build, 'package.json'), 'utf8')).version,
  rendererEntryHash: createHash('sha256')
    .update(await readFile(join(build, 'dist/index.html')))
    .digest('hex'),
  started: new Date().toISOString(),
  minutes,
  finished: '',
  elapsedSeconds: 0,
  status: 'running',
  buildHash: createHash('sha256')
    .update(await readFile(join(build, 'dist-electron/runtime/runtime.js')))
    .digest('hex'),
  conditions:
    'Hidden desktop + Web; isolated shared service; 10,000 historical events; 4 Hz streamed turns; 2 Hz PTY; 10-second panel/search cycle; minute reconnects; desktop reopen every 10 minutes; version mismatch writes rejected',
  cycles: 0,
  streamedTurns: 0,
  reconnects: 0,
  reopenings: 0,
  errors,
  failurePhase: '',
  cleanup: { checked: false, survivors: [] as { pid: number; identity: string }[] },
  samples: [] as {
    phase: string;
    reopenings: number;
    reconnects: number;
    seconds: number;
    desktopMiB: number;
    webMiB: number;
    serviceMiB: number;
    desktopHeapMiB: number;
    webHeapMiB: number;
    processes: number;
    serviceTcp: number;
    terminalBytes: number;
    pids: { desktop: number[]; web: number[]; service: number[] };
  }[],
};
async function save() {
  await writeFile(join(root, 'report.json.tmp'), JSON.stringify(report, null, 2) + '\n');
  await rename(join(root, 'report.json.tmp'), join(root, 'report.json'));
}
function observe(page: Page, app: ElectronApplication, host: string) {
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => {
    event('page-error', { host, error: redact(error.stack || error.message) });
    errors.push(error.message);
  });
  page.on('crash', () => {
    event('page-crash', { host });
    errors.push(`${host} renderer crashed during ${phase}`);
  });
  page.on('close', () => {
    const expected = expectedClose.has(app);
    event('page-close', { host, expected });
    if (!expected) errors.push(`${host} page unexpectedly closed during ${phase}`);
  });
}
async function observeApp(app: ElectronApplication, host: string) {
  const child = app.process();
  if (child.pid) appPids.set(app, child.pid);
  event('process-start', { host, pid: child.pid });
  for (const [name, stream] of [
    ['stdout', child.stdout],
    ['stderr', child.stderr],
  ] as const)
    stream?.on('data', (chunk: Buffer) =>
      event(`process-${name}`, { host, pid: child.pid, text: redact(chunk.toString()) }),
    );
  child.on('exit', (code, signal) => {
    const expected = expectedClose.has(app);
    event('process-exit', { host, pid: child.pid, code, signal, expected });
    if (!expected) errors.push(`${host} process exited (${code}/${signal}) during ${phase}`);
  });
  app.on('close', () => event('app-close', { host, expected: expectedClose.has(app) }));
  await app.evaluate(({ app, BrowserWindow }) => {
    app.on('child-process-gone', (_event, details) =>
      console.error(
        JSON.stringify({ diagnostic: 'child-process-gone', at: new Date().toISOString(), details }),
      ),
    );
    app.on('render-process-gone', (_event, contents, details) =>
      console.error(
        JSON.stringify({
          diagnostic: 'render-process-gone',
          at: new Date().toISOString(),
          id: contents.id,
          details,
        }),
      ),
    );
    app.on('before-quit', () =>
      console.error(JSON.stringify({ diagnostic: 'before-quit', at: new Date().toISOString() })),
    );
    for (const window of BrowserWindow.getAllWindows())
      window.on('closed', () =>
        console.error(
          JSON.stringify({ diagnostic: 'window-closed', at: new Date().toISOString() }),
        ),
      );
  });
}
async function closeApp(app: ElectronApplication | undefined) {
  if (!app) return;
  expectedClose.add(app);
  await app.close();
}
async function launchDesktop() {
  desktop = await electron.launch({ args: [build], env });
  await observeApp(desktop, 'desktop');
  desktopPage = await desktop.firstWindow();
  observe(desktopPage, desktop, 'desktop');
  await desktopPage.locator('.app-shell').waitFor();
  await desktopPage.locator('.session-row').filter({ hasText: 'Ten thousand events' }).click();
  await expect(desktopPage.locator('#composer')).toHaveValue('Preserved stability draft');
  expect(
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((window) => window.isVisible()),
    ),
  ).toBe(false);
}
async function processTable() {
  const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,ppid=,rss=,lstart=']);
  return stdout
    .trim()
    .split('\n')
    .map((line) => {
      const [pid, parent, rss, ...identity] = line.trim().split(/\s+/);
      return {
        pid: Number(pid),
        parent: Number(parent),
        rss: Number(rss),
        identity: identity.join(' '),
      };
    });
}
async function memory(seconds: number) {
  const servicePid = Number(await readFile(join(data, 'server.lock'), 'utf8'));
  const rows = await processTable();
  function group(pid: number) {
    const owned = new Set([pid]);
    let count = 0;
    while (count !== owned.size) {
      count = owned.size;
      for (const row of rows)
        if (owned.has(row.parent) && (row.pid !== servicePid || pid === servicePid))
          owned.add(row.pid);
    }
    for (const row of rows) if (owned.has(row.pid)) knownProcesses.set(row.pid, row.identity);
    return {
      count: owned.size,
      pids: [...owned],
      mib: Math.round(
        rows.reduce((sum, row) => sum + (owned.has(row.pid) ? row.rss : 0), 0) / 1024,
      ),
    };
  }
  const d = group(desktop!.process().pid!),
    w = group(web!.process().pid!),
    s = group(servicePid);
  async function heap(page: Page) {
    const cdp = await page.context().newCDPSession(page);
    try {
      const h = await cdp.send('Runtime.getHeapUsage');
      return +(h.usedSize / 1048576).toFixed(1);
    } finally {
      await cdp.detach();
    }
  }
  const sockets = await exec('/usr/sbin/lsof', ['-a', '-p', String(servicePid), '-iTCP', '-Fn']);
  report.samples.push({
    phase,
    reopenings: report.reopenings,
    reconnects: report.reconnects,
    seconds,
    desktopMiB: d.mib,
    webMiB: w.mib,
    serviceMiB: s.mib,
    desktopHeapMiB: await heap(desktopPage),
    webHeapMiB: await heap(webPage),
    processes: d.count + w.count + s.count,
    serviceTcp: sockets.stdout.split('\n').filter((row) => row.startsWith('n')).length,
    terminalBytes: terminalOffset,
    pids: { desktop: d.pids, web: w.pids, service: s.pids },
  });
  console.log(JSON.stringify(report.samples.at(-1)));
}
try {
  await save();
  stage('desktop-launch');
  await launchDesktop();
  const servicePid = await readFile(join(data, 'server.lock'), 'utf8');
  web = await electron.launch({ args: [join(build, 'tests/fixtures/web-browser.cjs')], env });
  await observeApp(web, 'web');
  webPage = await web.firstWindow();
  observe(webPage, web, 'web');
  await webPage.goto(await client.browserURL());
  await webPage.locator('.app-shell').waitFor();
  await webPage.locator('.session-row').filter({ hasText: 'Continuous output' }).click();
  const terminal = await request('terminalStart', {
    projectId: terminalProject.id,
    requestId: randomUUID(),
    cols: 80,
    rows: 24,
  });
  terminalId = terminal.id;
  const control = await request('terminalControl', { id: terminalId, action: 'acquire' });
  await request('terminalInput', {
    id: terminalId,
    lease: control.lease!,
    text: "i=0; while true; do i=$((i+1)); printf 'SOAK_%s\\n' $i; sleep 0.5; done\r",
  });
  await request('terminalControl', { id: terminalId, action: 'release', lease: control.lease! });
  const incompatible = new SharedRuntime(
    join(data, 'connection.json'),
    () => {},
    undefined,
    'incompatible-soak-version',
  );
  try {
    await expect(incompatible.request('webAddProject', { path: agentPath })).rejects.toThrow(
      'Background service version changed',
    );
  } finally {
    await incompatible.close();
  }
  const started = performance.now(),
    duration = minutes * 60000;
  let nextSample = 0,
    nextReconnect = reconnectSeconds * 1000,
    nextReopen = reopenSeconds * 1000;
  while (!interrupted && performance.now() - started < duration) {
    stage('stream-and-search');
    expect(await readFile(join(data, 'server.lock'), 'utf8')).toBe(servicePid);
    const cycleStarted = performance.now();
    const snapshot = await request('snapshot', {});
    const active = snapshot.sessions.find((session) => session.id === live.id)!;
    if (active.status !== 'running' && active.status !== 'queued') {
      if (active.status === 'failed') throw new Error('Streamed task failed');
      await request('send', { sessionId: live.id, text: 'soak-fixture' });
      report.streamedTurns++;
    }
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        request('searchMessages', { query: i % 2 ? 'absent' : 'Stability needle' }),
      ),
    );
    if (!JSON.stringify(results).includes('Stability needle'))
      throw new Error('Historical search lost data');
    stage('files');
    if (fault && report.cycles === 1) {
      event('fault-injected', { fault });
      desktop!.process().kill('SIGTERM');
      await delay(500);
    }
    await desktopPage.getByRole('button', { name: 'Files', exact: true }).click();
    const files = desktopPage.locator('.files-frame[aria-hidden="false"] .files-panel');
    await files.getByRole('treeitem', { name: 'sample.ts', exact: true }).click();
    await expect(files.locator('[data-code]')).toContainText('ready');
    await files.getByRole('button', { name: 'Close', exact: true }).click();
    stage('review-and-sidebar');
    await desktopPage.getByRole('button', { name: 'Review changes', exact: true }).click();
    await desktopPage
      .locator('.review-panel')
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await desktopPage.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
    await desktopPage.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
    await expect(desktopPage.locator('#composer')).toHaveValue('Preserved stability draft');
    stage('terminal');
    const output = await request('terminalRead', { id: terminalId, offset: terminalOffset });
    if (report.cycles > 0 && output.offset <= terminalOffset)
      throw new Error('Continuous PTY output stopped');
    terminalOffset = output.offset;
    expect(output.session.status).toBe('running');
    const elapsed = performance.now() - started;
    if (elapsed >= nextReconnect) {
      stage('web-reconnect');
      await webPage.context().setOffline(true);
      await webPage.waitForTimeout(250);
      await webPage.context().setOffline(false);
      await webPage.reload();
      await webPage.locator('.app-shell').waitFor();
      await webPage.locator('.session-row').filter({ hasText: 'Continuous output' }).click();
      report.reconnects++;
      nextReconnect += reconnectSeconds * 1000;
    }
    if (elapsed >= nextReopen) {
      stage('desktop-reopen');
      await memory(Math.round(elapsed / 1000));
      await closeApp(desktop);
      desktop = undefined;
      expect(await readFile(join(data, 'server.lock'), 'utf8')).toBe(servicePid);
      expect((await request('terminalList', { projectId: terminalProject.id }))[0].id).toBe(
        terminalId,
      );
      await launchDesktop();
      report.reopenings++;
      nextReopen += reopenSeconds * 1000;
      stage('after-desktop-reopen');
      await memory(Math.round((performance.now() - started) / 1000));
    }
    if (elapsed >= nextSample) {
      stage('minute-sample');
      await memory(Math.round(elapsed / 1000));
      nextSample += 60000;
    }
    if (errors.length) throw new Error(errors.join('\n'));
    report.cycles++;
    report.elapsedSeconds = Math.round((performance.now() - started) / 1000);
    await save();
    stage('cycle-idle');
    await delay(
      Math.max(
        0,
        Math.min(
          10000 - (performance.now() - cycleStarted),
          duration - (performance.now() - started),
        ),
      ),
    );
  }
  report.elapsedSeconds = Math.round((performance.now() - started) / 1000);
  stage('final-sample');
  await memory(report.elapsedSeconds);
  report.status = interrupted ? 'interrupted' : 'workload-passed-memory-review-required';
} catch (error) {
  report.status = 'failed';
  report.failurePhase = phase;
  errors.push(redact(error instanceof Error ? error.stack || error.message : String(error)));
  event('failure', { error: errors.at(-1) });
  process.exitCode = 1;
} finally {
  stage('cleanup');
  const cleanupError = (error: unknown) => {
    errors.push(`Cleanup: ${String(error)}`);
    report.status = 'failed';
    process.exitCode = 1;
  };
  // Capture any children created after the last minute sample before stopping their parents.
  const rows = await processTable();
  const owned = new Set(
    [...knownProcesses]
      .filter(([pid, identity]) => rows.some((row) => row.pid === pid && row.identity === identity))
      .map(([pid]) => pid),
  );
  // Playwright's process() can throw after an unexpected app exit; retain launch-time PIDs.
  for (const app of [desktop, web]) if (app && appPids.has(app)) owned.add(appPids.get(app)!);
  const lockPid = Number(await readFile(join(data, 'server.lock'), 'utf8').catch(() => '0'));
  if (lockPid) owned.add(lockPid);
  let size = -1;
  while (size !== owned.size) {
    size = owned.size;
    for (const row of rows) if (owned.has(row.parent)) owned.add(row.pid);
  }
  for (const row of rows) if (owned.has(row.pid)) knownProcesses.set(row.pid, row.identity);
  await closeApp(desktop).catch(cleanupError);
  await closeApp(web).catch(cleanupError);
  if (terminalId) await request('terminalStop', { id: terminalId }).catch(cleanupError);
  // Startup may have completed during desktop shutdown; read the isolated lock again.
  const finalServicePid = Number(
    await readFile(join(data, 'server.lock'), 'utf8').catch(() => '0'),
  );
  if (finalServicePid) {
    const finalRows = await processTable();
    const serviceOwned = new Set([finalServicePid]);
    let previous = -1;
    while (previous !== serviceOwned.size) {
      previous = serviceOwned.size;
      for (const row of finalRows) if (serviceOwned.has(row.parent)) serviceOwned.add(row.pid);
    }
    for (const row of finalRows)
      if (serviceOwned.has(row.pid)) knownProcesses.set(row.pid, row.identity);
    await client.stop().catch(cleanupError);
  }
  await client.close();
  await expect
    .poll(async () => {
      try {
        await stat(join(data, 'server.lock'));
        return true;
      } catch {
        return false;
      }
    })
    .toBe(false)
    .catch((error) => {
      errors.push(String(error));
      report.status = 'failed';
      process.exitCode = 1;
    });
  await expect
    .poll(
      async () => {
        const remaining = await processTable();
        report.cleanup.survivors = remaining
          .filter((row) => knownProcesses.get(row.pid) === row.identity)
          .map(({ pid, identity }) => ({ pid, identity }));
        return report.cleanup.survivors.length;
      },
      { timeout: 15000 },
    )
    .toBe(0)
    .catch(cleanupError);
  report.cleanup.checked = true;
  await cp(join(data, 'runtime.log'), join(root, 'runtime.raw.log')).catch(() => {});
  const runtimeLog = await readFile(join(root, 'runtime.raw.log'), 'utf8').catch(
    () => 'No runtime log',
  );
  await writeFile(join(root, 'runtime.redacted.log'), redact(runtimeLog));
  report.finished = new Date().toISOString();
  event('cleanup-complete', report.cleanup);
  await save();
  console.log(`Report: ${join(root, 'report.json')}`);
}
