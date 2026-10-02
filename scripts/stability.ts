// Fixed isolated workload. Default: two hours. No real model calls or user workspace writes.
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, cp, symlink, readFile, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Store } from '../electron/db/store';
import { SharedRuntime } from '../electron/shared-runtime';
import type { Method, Requests, Responses } from '../shared/types';
const exec = promisify(execFile);
const minutes = Number(process.env.MOOSE_STABILITY_MINUTES || 120);
if (!Number.isFinite(minutes) || minutes < 1 || minutes > 180)
  throw new Error('Invalid test duration');
const root = resolve('.moose-test', `stability-${Date.now()}`);
const build = join(root, 'build'),
  data = join(root, 'data');
await mkdir(build, { recursive: true });
await mkdir(data);
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
let interrupted = false;
process.once('SIGINT', () => {
  interrupted = true;
});
process.once('SIGTERM', () => {
  interrupted = true;
});
const report = {
  root,
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
  samples: [] as {
    seconds: number;
    desktopMiB: number;
    webMiB: number;
    serviceMiB: number;
    desktopHeapMiB: number;
    webHeapMiB: number;
    processes: number;
    serviceTcp: number;
    terminalBytes: number;
  }[],
};
const save = () => writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n');
function observe(page: Page) {
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => errors.push(error.message));
}
async function launchDesktop() {
  desktop = await electron.launch({ args: [build], env });
  desktopPage = await desktop.firstWindow();
  observe(desktopPage);
  await desktopPage.locator('.app-shell').waitFor();
  await desktopPage.locator('.session-row').filter({ hasText: 'Ten thousand events' }).click();
  await expect(desktopPage.locator('#composer')).toHaveValue('Preserved stability draft');
  expect(
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((window) => window.isVisible()),
    ),
  ).toBe(false);
}
async function memory(seconds: number) {
  const servicePid = Number(await readFile(join(data, 'server.lock'), 'utf8'));
  const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,ppid=,rss=']);
  const rows = stdout
    .trim()
    .split('\n')
    .map((row) => row.trim().split(/\s+/).map(Number));
  function group(pid: number) {
    const owned = new Set([pid]);
    let count = 0;
    while (count !== owned.size) {
      count = owned.size;
      for (const [child, parent] of rows)
        if (owned.has(parent) && (child !== servicePid || pid === servicePid)) owned.add(child);
    }
    return {
      count: owned.size,
      mib: Math.round(rows.reduce((sum, [id, , rss]) => sum + (owned.has(id) ? rss : 0), 0) / 1024),
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
    seconds,
    desktopMiB: d.mib,
    webMiB: w.mib,
    serviceMiB: s.mib,
    desktopHeapMiB: await heap(desktopPage),
    webHeapMiB: await heap(webPage),
    processes: d.count + w.count + s.count,
    serviceTcp: sockets.stdout.split('\n').filter((row) => row.startsWith('n')).length,
    terminalBytes: terminalOffset,
  });
  console.log(JSON.stringify(report.samples.at(-1)));
}
try {
  await launchDesktop();
  const servicePid = await readFile(join(data, 'server.lock'), 'utf8');
  web = await electron.launch({ args: [join(build, 'tests/fixtures/web-browser.cjs')], env });
  webPage = await web.firstWindow();
  observe(webPage);
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
    nextReconnect = 60000,
    nextReopen = 600000;
  while (!interrupted && performance.now() - started < duration) {
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
    await desktopPage.getByRole('button', { name: 'Files', exact: true }).click();
    const files = desktopPage.locator('.files-frame[aria-hidden="false"] .files-panel');
    await files.getByRole('treeitem', { name: 'sample.ts', exact: true }).click();
    await expect(files.locator('[data-code]')).toContainText('ready');
    await files.getByRole('button', { name: 'Close', exact: true }).click();
    await desktopPage.getByRole('button', { name: 'Review changes', exact: true }).click();
    await desktopPage
      .locator('.review-panel')
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await desktopPage.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
    await desktopPage.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
    await expect(desktopPage.locator('#composer')).toHaveValue('Preserved stability draft');
    const output = await request('terminalRead', { id: terminalId, offset: terminalOffset });
    if (report.cycles > 0 && output.offset <= terminalOffset)
      throw new Error('Continuous PTY output stopped');
    terminalOffset = output.offset;
    expect(output.session.status).toBe('running');
    const elapsed = performance.now() - started;
    if (elapsed >= nextReconnect) {
      await webPage.context().setOffline(true);
      await webPage.waitForTimeout(250);
      await webPage.context().setOffline(false);
      await webPage.reload();
      await webPage.locator('.app-shell').waitFor();
      await webPage.locator('.session-row').filter({ hasText: 'Continuous output' }).click();
      report.reconnects++;
      nextReconnect += 60000;
    }
    if (elapsed >= nextReopen) {
      await desktop!.close();
      desktop = undefined;
      expect(await readFile(join(data, 'server.lock'), 'utf8')).toBe(servicePid);
      expect((await request('terminalList', { projectId: terminalProject.id }))[0].id).toBe(
        terminalId,
      );
      await launchDesktop();
      report.reopenings++;
      nextReopen += 600000;
    }
    if (elapsed >= nextSample) {
      await memory(Math.round(elapsed / 1000));
      nextSample += 60000;
    }
    if (errors.length) throw new Error(errors.join('\n'));
    report.cycles++;
    report.elapsedSeconds = Math.round((performance.now() - started) / 1000);
    await save();
    await desktopPage.waitForTimeout(
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
  await memory(report.elapsedSeconds);
  report.status = interrupted ? 'interrupted' : 'workload-passed-memory-review-required';
} catch (error) {
  report.status = 'failed';
  errors.push(String(error));
  process.exitCode = 1;
} finally {
  report.finished = new Date().toISOString();
  await desktop?.close().catch(() => {});
  await web?.close().catch(() => {});
  if (terminalId) await request('terminalStop', { id: terminalId }).catch(() => {});
  await client.stop().catch(() => {});
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
  await save();
  console.log(`Report: ${join(root, 'report.json')}`);
}
