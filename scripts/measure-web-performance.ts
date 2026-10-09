// Empty isolated Web workspace with the browser HTTP cache disabled for each navigation.
import { _electron as electron, expect } from '@playwright/test';
import electronPath from 'electron';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../electron/db/store';
import { processMemory } from './process-memory';

const directory = await mkdtemp(join(tmpdir(), 'moose-web-perf-'));
const store = new Store(join(directory, 'moose.sqlite'));
store.setSettings({
  language: 'en',
  theme: 'light',
  codexEnabled: false,
  grokEnabled: false,
  piEnabled: false,
  opencodeEnabled: false,
});
store.close();
const child = spawn(electronPath as unknown as string, ['dist-electron/web-server/web-server.js'], {
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    MOOSE_WEB_DATA_DIR: directory,
    MOOSE_WEB_PORT: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (data) => {
  output += data;
});
child.stderr.on('data', (data) => {
  output += data;
});
let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
try {
  await expect.poll(() => output, { timeout: 15000 }).toContain('Moose Web:');
  const url = output.match(/Moose Web: (\S+)/)![1];
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.MOOSE_TEST_BACKGROUND = '1';
  app = await electron.launch({ args: [resolve('tests/fixtures/web-browser.cjs')], env });
  const page = await app.firstWindow();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const samples = [];
  for (let index = 0; index < 3; index++) {
    await page.goto(index === 0 ? url : new URL(url).origin);
    await page.locator('.app-shell').waitFor();
    const readyMs = await page.evaluate(() => performance.now());
    await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete));
    // Allow resource timing for the image and hydration to settle, not part of readyMs.
    await page.waitForTimeout(250);
    samples.push(
      await page.evaluate((readyMs) => {
        const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
        const assets = resources.filter((entry) =>
          new URL(entry.name).pathname.startsWith('/assets/'),
        );
        const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } })
          .memory;
        return {
          readyMs: Math.round(readyMs),
          firstContentfulPaintMs: Math.round(
            performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0,
          ),
          assetTransferBytes: assets.reduce((total, entry) => total + entry.transferSize, 0),
          assetEncodedBytes: assets.reduce((total, entry) => total + entry.encodedBodySize, 0),
          assetDecodedBytes: assets.reduce((total, entry) => total + entry.decodedBodySize, 0),
          jsHeapMiB: memory ? Math.round((memory.usedJSHeapSize / 1024 / 1024) * 10) / 10 : null,
          assets: assets.map((entry) => ({
            path: new URL(entry.name).pathname,
            encodedBytes: entry.encodedBodySize,
            decodedBytes: entry.decodedBodySize,
          })),
        };
      }, readyMs),
    );
  }
  await page.waitForTimeout(1500);
  const { residentMiB, physicalSource, total, processes } = await processMemory({
    service: child.pid,
  });
  console.log(
    JSON.stringify(
      {
        scenario: 'isolated-empty-web-hidden-browser-cache-disabled-localhost-warm-service',
        definition:
          'Three navigations; first includes token login, subsequent navigations reuse authentication. No disk cache flushing or network throttling. Heap is not process RSS. service: the ELECTRON_RUN_AS_NODE web service and its children 1.5 s after the third navigation; RSS plus macOS physical footprint or Linux PSS/USS. The browser is not counted.',
        samples,
        service: { residentMiB, physicalSource, total, processes },
      },
      null,
      2,
    ),
  );
} finally {
  await app?.close().catch(() => {});
  if (child.exitCode === null && child.signalCode === null) {
    const exit = once(child, 'exit');
    child.kill('SIGTERM');
    await exit;
  }
  await rm(directory, { recursive: true, force: true });
}
