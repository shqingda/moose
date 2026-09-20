// Repeated packaged launches with the same empty workspace; excludes CLI/network variability.
import { _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const dir = await mkdtemp(join(tmpdir(), 'moose-perf-'));
const executablePath = resolve('release/mac-arm64/Moose.app/Contents/MacOS/Moose');
const env: Record<string, string> = Object.fromEntries(
  Object.entries({ ...process.env, MOOSE_DATA_DIR: dir }).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  ),
);
delete env.ELECTRON_RUN_AS_NODE;
const rows: { readyMs: number; workingSetMiB: number; jsHeapMiB: number }[] = [];
try {
  // One untimed launch prepares identical persisted settings for each sample.
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
  }
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    const app = await electron.launch({ executablePath, env });
    try {
      const page = await app.firstWindow();
      await page.locator('.welcome').waitFor();
      const readyMs = Math.round(performance.now() - start);
      await page.waitForTimeout(1500);
      const workingSetMiB = await app.evaluate(
        ({ app }) =>
          app.getAppMetrics().reduce((sum, p) => sum + p.memory.workingSetSize, 0) / 1024,
      );
      const cdp = await page.context().newCDPSession(page);
      const heap = await cdp.send('Runtime.getHeapUsage');
      rows.push({
        readyMs,
        workingSetMiB: Math.round(workingSetMiB),
        jsHeapMiB: +(heap.usedSize / 1048576).toFixed(1),
      });
    } finally {
      await app.close();
    }
  }
  console.log(
    JSON.stringify({ scenario: 'packaged-empty-workspace-warm-cache', samples: rows }, null, 2),
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
