import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, realpath, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../../electron/db/store';
let app: ElectronApplication, dir: string;
const env = () => {
  const values = Object.fromEntries(
    Object.entries({ ...process.env, MOOSE_DATA_DIR: dir }).filter(
      (e): e is [string, string] => typeof e[1] === 'string',
    ),
  );
  delete values.ELECTRON_RUN_AS_NODE;
  return values;
};
test.afterEach(async () => {
  await app?.close().catch(() => {});
  if (dir) await rm(dir, { recursive: true, force: true });
});
async function launch() {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'moose-background-e2e-')));
  const root = join(dir, 'repo');
  await mkdir(root);
  const store = new Store(join(dir, 'moose.sqlite'));
  store.setSettings({
    language: 'en',
    codexPath: resolve('tests/fixtures/agent.mjs'),
    grokEnabled: false,
    piEnabled: false,
  });
  const project = store.addProject(root),
    session = store.createSession(project.id, 'codex');
  store.updateSession(session.id, { title: 'Background checks' });
  store.close();
  app = await electron.launch({ args: ['.'], env: env() });
  const page = await app.firstWindow();
  await page.waitForSelector('.app-shell');
  await page.getByText('Background checks', { exact: true }).first().click();
  return { page, root, scope: { projectId: project.id, sessionId: session.id } };
}
test('runs background commands, sends stdin and stops a command from the desktop panel', async () => {
  const { page } = await launch();
  await page.getByRole('button', { name: 'Background commands & schedules', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('textbox', { name: 'Shell command', exact: true })
    .fill('read line; printf "received:%s" "$line"');
  await dialog.getByRole('button', { name: 'Run command', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Send a line to stdin' }).fill('hello');
  await dialog.getByRole('button', { name: 'Send line', exact: true }).click();
  await expect(dialog.getByTestId('command-output')).toHaveText('received:hello');
  await expect(dialog.getByRole('region', { name: 'Command output' })).toContainText('completed');
  await dialog.getByRole('textbox', { name: 'Shell command', exact: true }).fill('sleep 30');
  await dialog.getByRole('button', { name: 'Run command', exact: true }).click();
  await dialog.getByRole('button', { name: 'Stop command', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Command output' })).toContainText('cancelled');
  await dialog.getByRole('textbox', { name: 'Schedule name' }).fill('Future inspection');
  await dialog
    .getByRole('textbox', { name: 'Task content' })
    .fill('Inspect without changing files');
  await dialog.getByRole('button', { name: 'Preview schedule' }).click();
  await dialog.getByRole('button', { name: 'Create reviewed schedule' }).click();
  await expect(dialog.getByRole('button', { name: 'Pause future runs' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Pause future runs' }).click();
  await expect(dialog.getByRole('button', { name: 'Resume schedule' })).toBeVisible();
  await expect(
    dialog.getByRole('heading', { name: 'Background commands & schedules' }),
  ).toBeInViewport();
  await page.screenshot({ path: 'test-results/background-panel.png' });
});
test('dispatches a one-time command while the window is closed and never replays it after restart', async () => {
  const { page, root, scope } = await launch();
  const schedule = await page.evaluate(
    (scope) =>
      window.moose.request('scheduleCreate', {
        ...scope,
        requestId: crypto.randomUUID(),
        name: 'Once',
        task: { kind: 'command', text: 'printf once >> scheduled.txt' },
        timezone: 'Asia/Shanghai',
        startAt: Date.now() + 2000,
        intervalMs: null,
      }),
    scope,
  );
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].close();
  });
  await expect
    .poll(async () => readFile(join(root, 'scheduled.txt'), 'utf8').catch(() => ''), {
      timeout: 10000,
    })
    .toBe('once');
  const windowEvent = app.waitForEvent('window');
  await app.evaluate(({ app }) => app.emit('activate'));
  const reopened = await windowEvent;
  await reopened.waitForSelector('.app-shell');
  await expect
    .poll(async () => {
      const rows = await reopened.evaluate(
        (scope) => window.moose.request('scheduleList', scope),
        scope,
      );
      return rows.find((row) => row.id === schedule.id)?.last?.status;
    })
    .toBe('completed');
  await app.close();
  app = await electron.launch({ args: ['.'], env: env() });
  const after = await app.firstWindow();
  await after.waitForSelector('.app-shell');
  const rows = await after.evaluate((scope) => window.moose.request('scheduleList', scope), scope);
  expect(rows[0].enabled).toBe(false);
  expect(rows[0].last?.status).toBe('completed');
  expect(await readFile(join(root, 'scheduled.txt'), 'utf8')).toBe('once');
});
test('edits paused schedules with review, preserves their timezone, and rejects stale changes', async () => {
  const { page, scope, root } = await launch();
  const original = await page.evaluate(
    (scope) =>
      window.moose.request('scheduleCreate', {
        ...scope,
        requestId: crypto.randomUUID(),
        name: 'Editable schedule',
        task: { kind: 'command', text: 'printf original' },
        timezone: 'America/New_York',
        startAt: Date.now() + 300000,
        intervalMs: 60000,
      }),
    scope,
  );
  await page.getByRole('button', { name: 'Background commands & schedules', exact: true }).click();
  const dialog = page.getByRole('dialog'),
    row = dialog.getByRole('region', { name: 'Editable schedule', exact: true });
  await expect(row.getByRole('button', { name: 'Edit schedule', exact: true })).toBeDisabled();
  await row.getByRole('button', { name: 'Pause future runs' }).click();
  await row.getByRole('button', { name: 'Edit schedule', exact: true }).click();
  await row.getByRole('textbox', { name: 'Task content' }).fill('discard this draft');
  await row.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(row).not.toContainText('discard this draft');
  await row.getByRole('button', { name: 'Edit schedule', exact: true }).click();
  await row.getByRole('textbox', { name: 'Task content' }).fill('printf edited');
  await row.getByRole('button', { name: 'Preview schedule' }).click();
  const preview = row.getByRole('alert');
  await expect(preview).toContainText(root);
  await expect(preview).toContainText('America/New_York');
  await expect(preview).toContainText('printf edited');
  await row.getByRole('spinbutton').fill('2');
  await expect(row.getByRole('button', { name: 'Save reviewed changes' })).toHaveCount(0);
  await row.getByRole('button', { name: 'Preview schedule' }).click();
  await row.getByRole('button', { name: 'Save reviewed changes' }).click();
  await expect(row.getByRole('button', { name: 'Resume schedule' })).toBeEnabled();
  const [edited] = await page.evaluate(
    (scope) => window.moose.request('scheduleList', scope),
    scope,
  );
  expect(edited).toMatchObject({
    id: original.id,
    sessionId: original.sessionId,
    enabled: false,
    timezone: original.timezone,
    nextAt: original.nextAt,
    intervalMs: 120000,
    task: { kind: 'command', text: 'printf edited' },
  });
  await row.getByRole('button', { name: 'Edit schedule', exact: true }).click();
  await row.getByRole('textbox', { name: 'Task content' }).fill('stale draft');
  await row.getByRole('button', { name: 'Preview schedule' }).click();
  await page.evaluate(
    (s) => window.moose.request('scheduleSet', { id: s.id, version: s.version, enabled: true }),
    edited,
  );
  await row.getByRole('button', { name: 'Save reviewed changes' }).click();
  await expect(row.getByRole('alert').filter({ hasText: 'Schedule changed' })).toBeVisible();
  const [unchanged] = await page.evaluate(
    (scope) => window.moose.request('scheduleList', scope),
    scope,
  );
  expect(unchanged.task.text).toBe('printf edited');
  expect(unchanged.enabled).toBe(true);
  await row.getByRole('button', { name: 'Cancel', exact: true }).click();
  await row.getByRole('button', { name: 'Pause future runs' }).click();
  await row.getByRole('button', { name: 'Edit schedule', exact: true }).click();
  await row.getByRole('button', { name: 'Preview schedule' }).click();
  await row.getByRole('button', { name: 'Save reviewed changes' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/schedule-edit.png' });
});
