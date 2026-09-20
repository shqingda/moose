// Hidden packaged launches; count the detached service as well as the desktop process tree.
import { _electron as electron, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SharedRuntime } from '../electron/shared-runtime';
const exec = promisify(execFile);
const dir = await mkdtemp(join(tmpdir(), 'moose-perf-'));
const executablePath = resolve('release/mac-arm64/Moose.app/Contents/MacOS/Moose');
const env: Record<string, string> = Object.fromEntries(
  Object.entries({
    ...process.env,
    MOOSE_DATA_DIR: dir,
    MOOSE_RUNTIME_MODE: 'shared',
    MOOSE_TEST_BACKGROUND: '1',
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
);
delete env.ELECTRON_RUN_AS_NODE;
delete env.MOOSE_SHARED_RUNTIME_FILE;
const stop = async () => {
  const runtime = new SharedRuntime(join(dir, 'connection.json'), () => {});
  try {
    await runtime.stop();
    await expect
      .poll(async () => {
        try {
          await stat(join(dir, 'server.lock'));
          return false;
        } catch {
          return true;
        }
      })
      .toBe(true);
  } finally {
    await runtime.close();
  }
};
async function residentMiB(desktop: number, service: number) {
  const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,ppid=,rss=']);
  const processes = stdout
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number));
  const owned = new Set([desktop, service]);
  let count = 0;
  while (count !== owned.size) {
    count = owned.size;
    for (const [pid, parent] of processes) if (owned.has(parent)) owned.add(pid);
  }
  return Math.round(
    processes.reduce((sum, [pid, , rss]) => sum + (owned.has(pid) ? rss : 0), 0) / 1024,
  );
}
const rows: { readyMs: number; residentMiB: number; jsHeapMiB: number }[] = [];
try {
  const setup = await electron.launch({ executablePath, env });
  try {
    const page = await setup.firstWindow();
    await page.locator('.app-shell').waitFor();
    await page.evaluate(() =>
      window.moose.request('settings', {
        codexEnabled: false,
        grokEnabled: false,
        piEnabled: false,
        opencodeEnabled: false,
      }),
    );
  } finally {
    await setup.close();
    await stop();
  }
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    const app = await electron.launch({ executablePath, env });
    try {
      const page = await app.firstWindow();
      await page.locator('.welcome').waitFor();
      const readyMs = Math.round(performance.now() - start);
      expect(
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some((w) => w.isVisible()),
        ),
      ).toBe(false);
      await page.waitForTimeout(1500);
      const service = Number(await readFile(join(dir, 'server.lock'), 'utf8'));
      const rss = await residentMiB(app.process().pid!, service);
      const cdp = await page.context().newCDPSession(page);
      const heap = await cdp.send('Runtime.getHeapUsage');
      rows.push({ readyMs, residentMiB: rss, jsHeapMiB: +(heap.usedSize / 1048576).toFixed(1) });
    } finally {
      await app.close();
      await stop();
    }
  }
  console.log(
    JSON.stringify(
      { scenario: 'packaged-shared-empty-hidden-warm-cache-service-restarted', samples: rows },
      null,
      2,
    ),
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
