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
  env: {
    ...env,
    MOOSE_DATA_DIR: dir,
    MOOSE_TEST_BACKGROUND: process.env.MOOSE_TEST_BACKGROUND || '1',
  },
});
try {
  const page = await app.firstWindow();
  await page.waitForSelector('.app-shell');
  const details = await app.evaluate(({ app, BrowserWindow }) => ({
    version: app.getVersion(),
    visible: BrowserWindow.getAllWindows()[0].isVisible(),
    sandbox: (
      BrowserWindow.getAllWindows()[0].webContents as unknown as {
        getLastWebPreferences(): { sandbox: boolean };
      }
    ).getLastWebPreferences().sandbox,
  }));
  if (process.env.MOOSE_TEST_BACKGROUND !== '0' && details.visible)
    throw new Error('Packaged acceptance window must stay hidden');
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
  const terminal = await page.evaluate(
    (projectId) =>
      window.moose.request('terminalStart', {
        projectId,
        requestId: crypto.randomUUID(),
        cols: 90,
        rows: 25,
      }),
    project.id,
  );
  await page.evaluate(
    (id) =>
      window.moose.request('terminalInput', {
        id,
        text: "test -t 0 && printf 'PACKAGED_PTY_OK\\n'\r",
      }),
    terminal.id,
  );
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(
            (id) => window.moose.request('terminalRead', { id, offset: 0 }),
            terminal.id,
          )
        ).data,
    )
    .toContain('PACKAGED_PTY_OK\r\n');
  await page.evaluate(() => window.moose.request('settings', { language: 'en' }));
  await page.getByRole('button', { name: 'Background commands & schedules', exact: true }).click();
  for (const position of ['Bottom', 'Right', 'Window']) {
    await page.getByRole('combobox', { name: 'Panel position', exact: true }).click();
    await page.getByRole('option', { name: position, exact: true }).click();
    await expect(page.locator('.xterm-screen')).toBeVisible();
  }
  const retained = await page.evaluate(
    (projectId) => window.moose.request('terminalList', { projectId }),
    project.id,
  );
  if (retained.length !== 1 || retained[0].id !== terminal.id || retained[0].status !== 'running')
    throw new Error('Packaged terminal placement lost its running session');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate((id) => window.moose.request('terminalStop', { id }), terminal.id);
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
      calendar: { weekdays: [1, 2, 3, 4, 5], hour: 9, minute: 0 },
    });
  }, project.id);
  if (
    schedule.enabled ||
    schedule.task.text !== 'printf edited' ||
    schedule.calendar?.hour !== 9 ||
    new Date(schedule.nextAt).getUTCHours() !== 9
  )
    throw new Error('Packaged schedule edit failed');
  await page.screenshot({ path: `test-results/package-${version}.png` });
  console.log(
    JSON.stringify({
      ...details,
      sqlite: 'ready',
      command: 'completed',
      terminal: 'verified-window-bottom-right',
      schedule: 'edited-paused',
    }),
  );
} finally {
  await app.close();
  await rm(dir, { recursive: true, force: true });
}
