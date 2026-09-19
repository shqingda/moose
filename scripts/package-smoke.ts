// 发行包验收：先验证签名，再用临时数据启动 .app，检查版本、沙箱和 SQLite。
import { execFileSync } from 'node:child_process';
import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
execFileSync('/usr/bin/codesign', [
  '--verify',
  '--deep',
  '--strict',
  resolve('release/mac-arm64/Moose.app'),
]);
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const dir = await mkdtemp(join(tmpdir(), 'moose-package-'));
const projectPath = join(dir, 'workspace');
await mkdir(projectPath);
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === 'string' && entry[0] !== 'ELECTRON_RUN_AS_NODE',
  ),
);
const app = await electron.launch({
  executablePath: resolve('release/mac-arm64/Moose.app/Contents/MacOS/Moose'),
  env: { ...env, MOOSE_DATA_DIR: dir },
});
try {
  const page = await app.firstWindow();
  await page.waitForSelector('.app-shell');
  const details = await app.evaluate(({ app, BrowserWindow }) => ({
    version: app.getVersion(),
    sandbox: (
      BrowserWindow.getAllWindows()[0].webContents as unknown as {
        getLastWebPreferences(): { sandbox: boolean };
      }
    ).getLastWebPreferences().sandbox,
  }));
  const snapshot = await page.evaluate(() => window.moose.request('snapshot', {}));
  if (details.version !== version || !details.sandbox || !Array.isArray(snapshot.projects))
    throw new Error('Packaged smoke failed');
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, projectPath);
  const project = await page.evaluate(() => window.moose.request('addProject', {}));
  if (!project) throw new Error('Packaged project creation failed');
  const job = await page.evaluate(
    (projectId) =>
      window.moose.request('commandStart', {
        projectId,
        requestId: crypto.randomUUID(),
        command: 'read line; printf "package:%s" "$line"',
      }),
    project.id,
  );
  await page.evaluate(
    (id) => window.moose.request('commandInput', { id, text: 'ready\n' }),
    job.id,
  );
  await expect
    .poll(async () => {
      const result = await page.evaluate(
        (id) => window.moose.request('commandRead', { id }),
        job.id,
      );
      return { status: result.status, output: result.output, exitCode: result.exitCode };
    })
    .toEqual({ status: 'completed', output: 'package:ready', exitCode: 0 });
  const schedule = await page.evaluate(async (projectId) => {
    const original = await window.moose.request('scheduleCreate', {
      projectId,
      requestId: crypto.randomUUID(),
      name: 'Package smoke',
      task: { kind: 'command', text: 'printf original' },
      timezone: 'UTC',
      startAt: Date.now() + 3600000,
      intervalMs: null,
    });
    const paused = await window.moose.request('scheduleSet', {
      id: original.id,
      version: original.version,
      enabled: false,
    });
    return window.moose.request('scheduleUpdate', {
      id: paused.id,
      version: paused.version,
      name: 'Edited smoke',
      task: { kind: 'command', text: 'printf edited' },
      timezone: paused.timezone,
      startAt: paused.nextAt,
      intervalMs: paused.intervalMs,
    });
  }, project.id);
  if (schedule.enabled || schedule.task.text !== 'printf edited')
    throw new Error('Packaged schedule edit failed');
  await page.screenshot({ path: `test-results/package-${version}.png` });
  console.log(
    JSON.stringify({
      ...details,
      sqlite: 'ready',
      command: 'completed',
      schedule: 'edited-paused',
    }),
  );
} finally {
  await app.close();
  await rm(dir, { recursive: true, force: true });
}
