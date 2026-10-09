// Packaged desktop launches on an isolated empty workspace; the shared service is restarted per run.
// `legacy` keeps the 0.23.0 conditions (hidden window, warm disk cache, providers disabled). The other
// scenarios change one condition each; `real` combines a visible window, cold cache and providers.
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { arch, cpus, release, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { SharedRuntime } from '../electron/shared-runtime';
import { processMemory } from './process-memory';
import { version } from '../package.json';
const exec = promisify(execFile);

interface Conditions {
  window: 'hidden' | 'visible';
  diskCache: 'warm' | 'cold';
  providers: 'disabled' | 'enabled';
  /** `fresh` launches every run on a new data directory: a true first run with nothing cached. */
  data?: 'fresh';
}
const scenarios: Record<string, Conditions> = {
  legacy: { window: 'hidden', diskCache: 'warm', providers: 'disabled' },
  visible: { window: 'visible', diskCache: 'warm', providers: 'disabled' },
  cold: { window: 'hidden', diskCache: 'cold', providers: 'disabled' },
  providers: { window: 'hidden', diskCache: 'warm', providers: 'enabled' },
  real: { window: 'visible', diskCache: 'cold', providers: 'enabled' },
  first: { window: 'hidden', diskCache: 'warm', providers: 'enabled', data: 'fresh' },
};
const { values } = parseArgs({
  options: {
    scenario: { type: 'string', multiple: true },
    runs: { type: 'string', default: '3' },
    executable: { type: 'string' },
    unpackaged: { type: 'boolean', default: false },
  },
});
const selected = (values.scenario ?? ['legacy']).flatMap((name) =>
  name === 'all' ? Object.keys(scenarios) : [name],
);
for (const name of selected)
  if (!scenarios[name])
    throw new Error(`Unknown scenario ${name}; use ${Object.keys(scenarios).join(', ')} or all`);
const runs = Number(values.runs);
const executablePath = resolve(
  values.executable ??
    (process.platform === 'darwin'
      ? 'release/mac-arm64/Moose.app/Contents/MacOS/Moose'
      : 'release/linux-unpacked/moose'),
);
const build = values.unpackaged ? 'unpackaged' : 'packaged';
const scenarioId = ({ window, diskCache, providers, data }: Conditions) =>
  `${build}-shared-${data === 'fresh' ? 'first-run' : 'empty'}-${window}-${diskCache}-cache${providers === 'enabled' ? '-providers-enabled' : ''}-service-restarted`;

function launcher(dir: string) {
  return (window: Conditions['window']) => {
    const env: Record<string, string> = Object.fromEntries(
      Object.entries({
        ...process.env,
        MOOSE_DATA_DIR: dir,
        MOOSE_RUNTIME_MODE: 'shared',
        MOOSE_TEST_BACKGROUND: window === 'hidden' ? '1' : '0',
      }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.MOOSE_SHARED_RUNTIME_FILE;
    return electron.launch(values.unpackaged ? { args: ['.'], env } : { executablePath, env });
  };
}
/** On Linux the detached service inherits the desktop's open pipes, so wait for the desktop process to exit. */
async function close(app: ElectronApplication) {
  const child = app.process();
  const closing = app.close();
  closing.catch(() => {});
  await Promise.race([
    closing,
    child.exitCode === null && child.signalCode === null
      ? new Promise((resolve) => child.once('exit', resolve))
      : Promise.resolve(),
  ]);
}
async function stop(dir: string) {
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
}
async function dropDiskCache() {
  try {
    if (process.platform === 'darwin') await exec('sudo', ['-n', '/usr/sbin/purge']);
    else {
      await exec('sync');
      await exec('sudo', ['-n', 'sh', '-c', 'echo 3 > /proc/sys/vm/drop_caches']);
    }
  } catch (error) {
    throw new Error(
      'The cold scenarios flush the disk cache with sudo. Run `sudo -v` in this terminal first.',
      { cause: error },
    );
  }
}

type Timeline = { origin: number; marks: [string, number][] };
const mainTimeline = (app: ElectronApplication) =>
  app.evaluate((): Timeline => ({
    origin: performance.timeOrigin,
    marks: performance.getEntriesByType('mark').map((mark) => [mark.name, mark.startTime]),
  }));
/** Epoch time the first provider probe returned through the main process, if it did. */
async function probeEnd(app: ElectronApplication) {
  const deadline = Date.now() + 70000;
  while (Date.now() < deadline) {
    const { origin, marks } = await mainTimeline(app);
    const end = marks.find(([name]) => name === 'moose/main/didProbeProviders');
    if (end) return origin + end[1];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
/** Milliseconds since electron.launch(): main and renderer timelines plus service file writes. */
async function phases(app: ElectronApplication, page: Page, dir: string, launchedAt: number) {
  const main = await mainTimeline(app);
  const renderer = await page.evaluate((): Timeline => ({
    origin: performance.timeOrigin,
    marks: [...performance.getEntriesByType('paint'), ...performance.getEntriesByType('mark')].map(
      (entry) => [entry.name, entry.startTime],
    ),
  }));
  const since = (epoch: number) => Math.round(epoch - launchedAt);
  const marks: [string, number][] = [
    ['main/processStart', since(main.origin)],
    ...main.marks.map(([name, time]): [string, number] => [
      name.replace(/^moose\//, ''),
      since(main.origin + time),
    ]),
    ['renderer/navigationStart', since(renderer.origin)],
    ...renderer.marks.map(([name, time]): [string, number] => [
      'renderer/' + name.replace(/^moose\/renderer\//, ''),
      since(renderer.origin + time),
    ]),
  ];
  // server.lock is written once the service bundle has evaluated; connection.json once it listens.
  for (const [name, file] of [
    ['service/lockWritten', 'server.lock'],
    ['service/connectionWritten', 'connection.json'],
  ])
    marks.push([name, since((await stat(join(dir, file))).mtimeMs)]);
  return Object.fromEntries(marks.sort((a, b) => a[1] - b[1]));
}
const providerSummary = (page: Page) =>
  page.evaluate(async () =>
    (await window.moose.request('providers', {})).map(
      ({ provider, enabled, available, connected, version, models, error }) => ({
        provider,
        ...(error ? { error } : {}),
        enabled,
        available,
        connected,
        version,
        models: models.length,
      }),
    ),
  );

async function measure(
  launch: () => Promise<ElectronApplication>,
  dir: string,
  conditions: Conditions,
) {
  const launchedAt = performance.timeOrigin + performance.now();
  const app = await launch();
  try {
    const page = await app.firstWindow();
    await page.locator('.welcome').waitFor();
    const readyAt = performance.timeOrigin + performance.now();
    const visible = () =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isVisible()));
    if (conditions.window === 'hidden') expect(await visible()).toBe(false);
    else await expect.poll(visible, { timeout: 30000 }).toBe(true);
    // Settle 1.5 s after ready (0.23.0) and after the first provider probe returned.
    const probedAt = await probeEnd(app);
    await page.waitForTimeout(
      Math.max(
        0,
        Math.max(readyAt, probedAt ?? 0) + 1500 - performance.timeOrigin - performance.now(),
      ),
    );
    const service = Number(await readFile(join(dir, 'server.lock'), 'utf8'));
    const memory = await processMemory({ desktop: app.process().pid!, service });
    const cdp = await page.context().newCDPSession(page);
    const heap = await cdp.send('Runtime.getHeapUsage');
    const mainHeap = await app.evaluate(() => process.memoryUsage().heapUsed);
    return {
      readyMs: Math.round(readyAt - launchedAt),
      residentMiB: memory.residentMiB,
      jsHeapMiB: +(heap.usedSize / 1048576).toFixed(1),
      mainHeapMiB: +(mainHeap / 1048576).toFixed(1),
      probeReturned: probedAt !== undefined,
      marks: await phases(app, page, dir, launchedAt),
      memory: {
        physicalSource: memory.physicalSource,
        total: memory.total,
        roles: memory.roles,
        processes: memory.processes,
      },
      ...(conditions.providers === 'enabled' ? { providers: await providerSummary(page) } : {}),
    };
  } finally {
    await close(app);
    await stop(dir);
  }
}
type Sample = Awaited<ReturnType<typeof measure>>;
function median(values: (number | undefined)[]) {
  const sorted = values
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b);
  if (!sorted.length) return undefined;
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function summarize(samples: Sample[]) {
  const keys = <T extends object>(rows: T[]) => [
    ...new Set(rows.flatMap((row) => Object.keys(row))),
  ];
  const totals = samples.map((sample) => sample.memory.total);
  const roles = samples.map((sample) => sample.memory.roles);
  return {
    readyMs: median(samples.map((sample) => sample.readyMs)),
    residentMiB: median(samples.map((sample) => sample.residentMiB)),
    jsHeapMiB: median(samples.map((sample) => sample.jsHeapMiB)),
    footprintMiB: median(totals.map((total) => total.footprintMiB)),
    pssMiB: median(totals.map((total) => total.pssMiB)),
    roles: Object.fromEntries(
      keys(roles).map((role) => [
        role,
        {
          rssMiB: median(roles.map((row) => row[role]?.rssMiB)),
          footprintMiB: median(roles.map((row) => row[role]?.footprintMiB)),
          pssMiB: median(roles.map((row) => row[role]?.pssMiB)),
        },
      ]),
    ),
    marks: Object.fromEntries(
      keys(samples.map((sample) => sample.marks))
        .map((name): [string, number | undefined] => [
          name,
          median(samples.map((sample) => sample.marks[name])),
        ])
        .sort((a, b) => (a[1] ?? 0) - (b[1] ?? 0)),
    ),
  };
}

const git = (args: string[]) =>
  exec('git', args).then(
    ({ stdout }) => stdout.trim(),
    () => null,
  );
const results = [];
for (const name of selected) {
  const conditions = scenarios[name];
  const dir = await mkdtemp(join(tmpdir(), 'moose-perf-'));
  const launch = launcher(dir);
  try {
    if (conditions.data === 'fresh') {
      const samples: Sample[] = [];
      for (let index = 0; index < runs; index++) {
        const fresh = await mkdtemp(join(tmpdir(), 'moose-perf-first-'));
        try {
          samples.push(await measure(() => launcher(fresh)(conditions.window), fresh, conditions));
        } finally {
          await rm(fresh, { recursive: true, force: true });
        }
      }
      results.push({
        name,
        scenario: scenarioId(conditions),
        conditions: {
          ...conditions,
          data: 'new empty data directory per run: no database, provider cache or compile cache',
          runtime: 'shared ELECTRON_RUN_AS_NODE service, stopped after every launch',
          diskCacheMethod: 'none; earlier launches leave the application files cached',
        },
        summary: summarize(samples),
        samples,
      });
      continue;
    }
    const setup = await launch('hidden');
    try {
      const page = await setup.firstWindow();
      await page.locator('.app-shell').waitFor();
      if (conditions.providers === 'disabled')
        await page.evaluate(() =>
          window.moose.request('settings', {
            codexEnabled: false,
            grokEnabled: false,
            piEnabled: false,
            opencodeEnabled: false,
          }),
        );
    } finally {
      await close(setup);
      await stop(dir);
    }
    const samples: Sample[] = [];
    for (let index = 0; index < runs; index++) {
      if (conditions.diskCache === 'cold') await dropDiskCache();
      samples.push(await measure(() => launch(conditions.window), dir, conditions));
    }
    results.push({
      name,
      scenario: scenarioId(conditions),
      conditions: {
        ...conditions,
        data: `isolated empty workspace; a hidden setup launch created the database${conditions.providers === 'disabled' ? ' and disabled all four providers' : ''}`,
        runtime: 'shared ELECTRON_RUN_AS_NODE service, stopped after every launch',
        diskCacheMethod:
          conditions.diskCache === 'cold'
            ? process.platform === 'darwin'
              ? 'sudo purge before every launch'
              : 'sync and drop_caches before every launch'
            : 'none; earlier launches leave the files cached',
        ...(name === 'legacy'
          ? { comparableTo: '0.23.0 perf-after.json: readyMs, residentMiB, jsHeapMiB' }
          : {}),
      },
      summary: summarize(samples),
      samples,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
console.log(
  JSON.stringify(
    {
      version,
      commit: await git(['rev-parse', 'HEAD']),
      uncommittedChanges: !!(await git(['status', '--porcelain'])),
      host: {
        platform: process.platform,
        release: release(),
        arch: arch(),
        cpu: cpus()[0]?.model,
        cores: cpus().length,
        memoryGiB: Math.round(totalmem() / 1024 ** 3),
      },
      build,
      executable: values.unpackaged ? 'electron .' : executablePath,
      definition:
        'readyMs: electron.launch() until .welcome is visible in the page, including Playwright launch overhead (0.23.0 definition). residentMiB: RSS of the desktop and service process trees summed (0.23.0 definition; counts shared pages once per process). memory: RSS per process role plus macOS physical footprint (vmmap, falling back to top) or Linux PSS/USS, sampled 1.5 s after ready and 1.5 s after the first provider probe returned. marks: ms since electron.launch(); main and service marks from the main-process performance timeline, lockWritten/connectionWritten from service file mtimes, renderer entries from the page timeline. summary values are medians; every sample is kept.',
      scenarios: results,
    },
    null,
    2,
  ),
);
