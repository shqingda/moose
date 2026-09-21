import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, realpath, rm, readFile, writeFile } from 'node:fs/promises';
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
    opencodeEnabled: false,
    theme: 'light',
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
  await dialog.getByRole('tab', { name: 'Commands', exact: true }).click();
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
  await dialog.getByRole('tab', { name: 'Schedules', exact: true }).click();
  await dialog.getByRole('button', { name: 'New schedule', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Schedule name' }).fill('Future inspection');
  await dialog
    .getByRole('textbox', { name: 'Task content' })
    .fill('Inspect without changing files');
  await dialog.getByRole('button', { name: 'Preview schedule' }).click();
  await dialog.getByRole('button', { name: 'Create schedule' }).click();
  await expect(dialog.getByRole('button', { name: 'Pause future runs' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Pause future runs' }).click();
  await expect(dialog.getByRole('button', { name: 'Resume schedule' })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'Schedules', exact: true })).toBeInViewport();
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
  await dialog.getByRole('tab', { name: 'Schedules', exact: true }).click();
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
  await expect(row.getByRole('button', { name: 'Save' })).toHaveCount(0);
  await row.getByRole('button', { name: 'Preview schedule' }).click();
  await row.getByRole('button', { name: 'Save' }).click();
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
  await row.getByRole('button', { name: 'Save' }).click();
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
  await row.getByRole('button', { name: 'Save' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/schedule-edit.png' });
});

test('runs a real PTY, resizes it, edits with vim and survives closing the panel', async () => {
  const { page, root, scope } = await launch();
  await page.getByRole('button', { name: 'Background commands & schedules', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'New terminal', exact: true })).toHaveText(
    'New terminal',
  );
  const emptyButtonHeight = await dialog
    .getByRole('button', { name: 'New terminal', exact: true })
    .evaluate((el) => getComputedStyle(el).height);
  await dialog.getByRole('button', { name: 'New terminal', exact: true }).click();
  await expect(dialog.locator('.terminal-session-tab')).toBeVisible();
  expect(
    await dialog.locator('.terminal-session-tab').evaluate((el) => getComputedStyle(el).height),
  ).toBe(emptyButtonHeight);
  await expect(dialog.getByRole('button', { name: 'New terminal', exact: true })).toHaveText('');
  await expect(dialog.locator('.xterm-screen')).toBeVisible();
  let id = '';
  await expect
    .poll(async () => {
      const sessions = await page.evaluate(
        (scope) => window.moose.request('terminalList', scope),
        scope,
      );
      id = sessions[0]?.id || '';
      return sessions[0]?.status;
    })
    .toBe('running');
  const input = async (text: string) =>
    page.evaluate(({ id, text }) => window.moose.request('terminalInput', { id, text }), {
      id,
      text,
    });
  const output = () =>
    page.evaluate((id) => window.moose.request('terminalRead', { id, offset: 0 }), id);
  await input("test -t 0 && test -t 1 && printf 'PTY_READY\\n'\r");
  await expect.poll(async () => (await output()).data).toContain('PTY_READY\r\n');
  await page.evaluate(
    (id) => window.moose.request('terminalResize', { id, cols: 117, rows: 31 }),
    id,
  );
  await input('stty size\r');
  await expect.poll(async () => (await output()).data).toContain('31 117');
  await input('/usr/bin/vi -u NONE -n terminal-edit.txt\r');
  await expect.poll(async () => (await output()).data).toContain('\x1b[?1049h');
  await dialog.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('iHello from a real terminal');
  await page.keyboard.press('Escape');
  // Escape belongs to vim, not the enclosing dialog.
  await expect(dialog).toBeVisible();
  await page.keyboard.type(':wq');
  await page.keyboard.press('Enter');
  await expect
    .poll(() => readFile(join(root, 'terminal-edit.txt'), 'utf8').catch(() => ''))
    .toBe('Hello from a real terminal\n');
  await input('sleep 30\r');
  await page.keyboard.press('Control+c');
  await input("printf 'AFTER_INTERRUPT\\n'\r");
  await expect.poll(async () => (await output()).data).toContain('AFTER_INTERRUPT\r\n');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await input("printf 'HIDDEN_PANEL\\n'\r");
  await page.getByRole('button', { name: 'Background commands & schedules', exact: true }).click();
  await expect(page.locator('.xterm-screen')).toBeVisible();
  await expect.poll(async () => (await output()).data).toContain('HIDDEN_PANEL\r\n');
  await page.screenshot({ path: 'test-results/interactive-terminal.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Close terminal', exact: true }).click();
  await expect.poll(async () => (await output()).session.status).toBe('cancelled');
  // Directory ownership is released after the PTY helper exits.
  const job = await page.evaluate(
    (scope) =>
      window.moose.request('commandStart', {
        ...scope,
        requestId: crypto.randomUUID(),
        command: 'printf released',
      }),
    scope,
  );
  await expect
    .poll(
      async () =>
        (await page.evaluate((id) => window.moose.request('commandRead', { id }), job.id)).status,
    )
    .toBe('completed');
});

test('cleans up PTY children after runtime loss and marks the session unknown after restart', async () => {
  const { page, root, scope } = await launch();
  const session = await page.evaluate(
    (scope) =>
      window.moose.request('terminalStart', {
        ...scope,
        requestId: crypto.randomUUID(),
        cols: 80,
        rows: 24,
      }),
    scope,
  );
  await page.evaluate(
    (id) =>
      window.moose.request('terminalInput', {
        id,
        text: 'echo $$ > terminal-shell.pid; sleep 300 & echo $! > terminal-child.pid; wait\r',
      }),
    session.id,
  );
  await expect
    .poll(() => readFile(join(root, 'terminal-child.pid'), 'utf8').catch(() => ''))
    .toMatch(/^\d+/);
  const pids = await Promise.all(
    ['terminal-shell.pid', 'terminal-child.pid'].map(async (file) =>
      Number((await readFile(join(root, file), 'utf8')).trim()),
    ),
  );
  await app.evaluate(({ app }) => {
    const runtime = app.getAppMetrics().find((item) => item.name === 'Moose Agent Runtime');
    if (!runtime) throw new Error('Runtime not found');
    process.kill(runtime.pid, 'SIGKILL');
  });
  for (const pid of pids)
    await expect
      .poll(
        () => {
          try {
            process.kill(pid, 0);
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 10000 },
      )
      .toBe(false);
  await app.close();
  app = await electron.launch({ args: ['.'], env: env() });
  const after = await app.firstWindow();
  await after.waitForSelector('.app-shell');
  const result = await after.evaluate(
    (id) => window.moose.request('terminalRead', { id, offset: 0 }),
    session.id,
  );
  expect(result.session.status).toBe('unknown');
});

test('bounds PTY output and persists a stopped session without replaying input on restart', async () => {
  const { page, scope } = await launch();
  const args = { ...scope, requestId: crypto.randomUUID(), cols: 80, rows: 24 };
  const session = await page.evaluate((args) => window.moose.request('terminalStart', args), args);
  const duplicate = await page.evaluate(
    (args) => window.moose.request('terminalStart', args),
    args,
  );
  expect(duplicate.id).toBe(session.id);
  await page.evaluate(
    (id) =>
      window.moose.request('terminalInput', {
        id,
        text: "head -c 1100000 /dev/zero | tr '\\0' x; printf '\\nOUTPUT_END\\n'\r",
      }),
    session.id,
  );
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(
            (id) => window.moose.request('terminalRead', { id, offset: 0 }),
            session.id,
          )
        ).offset,
    )
    .toBeGreaterThan(1100000);
  const output = await page.evaluate(
    (id) => window.moose.request('terminalRead', { id, offset: 0 }),
    session.id,
  );
  expect(output.reset).toBe(true);
  expect(output.data.length).toBeLessThanOrEqual(1024 * 1024);
  expect(output.data).toContain('OUTPUT_END');
  await app.close();
  app = await electron.launch({ args: ['.'], env: env() });
  const after = await app.firstWindow();
  await after.waitForSelector('.app-shell');
  const restored = await after.evaluate(
    (id) => window.moose.request('terminalRead', { id, offset: 0 }),
    session.id,
  );
  expect(restored.session.status).toBe('interrupted');
  expect(restored.offset).toBeGreaterThanOrEqual(output.offset);
  expect(restored.data).toContain('OUTPUT_END');
});
test('previews timezone calendar runs and preserves weekdays when editing', async () => {
  const { page, scope } = await launch();
  await page.getByRole('button', { name: 'Background commands & schedules', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Schedules', exact: true }).click();
  await dialog.getByRole('button', { name: 'New schedule', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Schedule name' }).fill('Weekday inspection');
  await dialog.getByRole('textbox', { name: 'Task content' }).fill('Inspect only');
  await dialog.getByRole('combobox', { name: 'Repeat', exact: true }).click();
  await page.getByRole('option', { name: 'Choose weekdays', exact: true }).click();
  await dialog.getByLabel('Tue', { exact: true }).uncheck();
  await dialog.getByLabel('Time', { exact: true }).fill('09:15');
  await dialog.getByLabel('Time zone', { exact: true }).fill('America/New_York');
  await dialog.getByRole('button', { name: 'Preview schedule' }).click();
  await expect(dialog.locator('.schedule-occurrences li')).toHaveCount(3);
  await page.screenshot({ path: 'test-results/calendar-preview.png', animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Create schedule' }).click();
  const row = dialog.getByRole('region', { name: 'Weekday inspection' });
  await expect(row).toContainText('Mon · Wed · Thu · Fri');
  const stored = await page.evaluate((scope) => window.moose.request('scheduleList', scope), scope);
  expect(stored[0].calendar).toEqual({ weekdays: [1, 3, 4, 5], hour: 9, minute: 15 });
  expect(stored[0].timezone).toBe('America/New_York');
  expect(stored[0].intervalMs).toBeNull();
  await row.getByRole('button', { name: 'Pause future runs' }).click();
  await row.getByRole('button', { name: 'Edit schedule', exact: true }).click();
  await expect(row.getByLabel('Tue', { exact: true })).not.toBeChecked();
  await expect(row.getByLabel('Time zone', { exact: true })).toHaveValue('America/New_York');
  await row.getByRole('combobox', { name: 'Repeat', exact: true }).click();
  await page.getByRole('option', { name: 'Every day', exact: true }).click();
  await row.getByRole('button', { name: 'Preview schedule' }).click();
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(row).toContainText('Every day');
  const edited = await page.evaluate((scope) => window.moose.request('scheduleList', scope), scope);
  expect(edited[0].calendar?.weekdays).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(edited[0].enabled).toBe(false);
});

test('moves the same terminal between window, bottom and right without stopping its shell', async () => {
  const { page, scope } = await launch();
  await page.getByRole('button', { name: 'Background commands & schedules', exact: true }).click();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  await expect(page.locator('.xterm-screen')).toBeVisible();
  const id = (await page.evaluate((scope) => window.moose.request('terminalList', scope), scope))[0]
    .id;
  await page.evaluate(
    (id) =>
      window.moose.request('terminalInput', { id, text: 'export MOOSE_DOCK_CHECK=preserved\r' }),
    id,
  );
  const change = async (name: string) => {
    await page.getByRole('combobox', { name: 'Panel position', exact: true }).click();
    await page.getByRole('option', { name, exact: true }).click();
    await expect(page.locator('.xterm-screen')).toBeVisible();
  };
  const headerMetrics = () =>
    page.locator('.background-bar').evaluate((bar) => {
      const tab = bar.querySelector('[role="tab"]')!;
      const picker = bar.querySelector('[role="combobox"]')!;
      return {
        font: getComputedStyle(tab).fontSize,
        pickerFont: getComputedStyle(picker).fontSize,
        pickerHeight: picker.getBoundingClientRect().height,
      };
    });
  const dialogMetrics = await headerMetrics();
  await change('Bottom');
  expect(await headerMetrics()).toEqual(dialogMetrics);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.workspace-stage')).toHaveAttribute('data-dock', 'bottom');
  await page.locator('#composer').fill('Draft beside terminal');
  await page.screenshot({ path: 'test-results/terminal-bottom.png', animations: 'disabled' });
  await change('Right');
  expect(await headerMetrics()).toEqual(dialogMetrics);
  await expect(page.getByRole('combobox', { name: 'Panel position', exact: true })).toContainText(
    'Right',
  );
  expect(
    (await page.getByRole('combobox', { name: 'Panel position', exact: true }).boundingBox())!
      .width,
  ).toBeGreaterThan(45);
  await expect(page.locator('#composer')).toHaveValue('Draft beside terminal');
  await page.evaluate(
    (id) =>
      window.moose.request('terminalInput', {
        id,
        text: 'printf \'DOCK_%s\\n\' "$MOOSE_DOCK_CHECK"\r',
      }),
    id,
  );
  await expect
    .poll(
      async () =>
        (await page.evaluate((id) => window.moose.request('terminalRead', { id, offset: 0 }), id))
          .data,
    )
    .toContain('DOCK_preserved\r\n');
  expect(
    await page.evaluate((scope) => window.moose.request('terminalList', scope), scope),
  ).toHaveLength(1);
  await page.screenshot({ path: 'test-results/terminal-right.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await expect(page.locator('.workspace-stage')).toHaveAttribute('data-dock', 'bottom');
  await page.locator('.review-panel').getByRole('button', { name: 'Close', exact: true }).click();
  await change('Right');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 740));
  await page.evaluate(() => window.moose.request('settings', { theme: 'dark' }));
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(
    page.getByRole('combobox', { name: 'Panel position', exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: 'test-results/terminal-right-narrow-dark.png',
    animations: 'disabled',
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 860));
  await page.evaluate(() => window.moose.request('settings', { theme: 'light' }));
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await change('Window');
  const screen = await page.locator('.terminal-screen').boundingBox();
  const dialog = await page.getByRole('dialog').boundingBox();
  expect(screen!.height / dialog!.height).toBeGreaterThan(0.7);
  await page.screenshot({ path: 'test-results/terminal-window.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Close terminal', exact: true }).click();
});

test('opens concurrent terminal tabs and releases the directory only after the last closes', async () => {
  const { page, scope } = await launch();
  await page.getByRole('button', { name: 'Background commands & schedules', exact: true }).click();
  const panel = page.locator('.terminal-panel');
  const newTerminal = page.getByRole('button', { name: 'New terminal', exact: true });
  await newTerminal.click();
  await expect(panel.getByRole('tab')).toHaveCount(1);
  await newTerminal.click();
  await expect(panel.getByRole('tab')).toHaveCount(2);
  const sessions = await page.evaluate(
    (scope) => window.moose.request('terminalList', scope),
    scope,
  );
  expect(sessions).toHaveLength(2);
  for (const session of sessions) {
    expect(session.title).toMatch(/.+@.+/);
    await page.evaluate(({ id, text }) => window.moose.request('terminalInput', { id, text }), {
      id: session.id,
      text: `printf 'TAB_${session.id}\\n'\r`,
    });
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(
              (id) => window.moose.request('terminalRead', { id, offset: 0 }),
              session.id,
            )
          ).data,
      )
      .toContain(`TAB_${session.id}\r\n`);
  }
  await panel.getByRole('tab').first().click();
  await expect(panel.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
  await panel.getByRole('tab').first().press('ArrowRight');
  await expect(panel.getByRole('tab').last()).toBeFocused();
  await page.screenshot({ path: 'test-results/terminal-tabs.png' });
  await panel.getByRole('button', { name: 'Close terminal', exact: true }).first().click();
  await expect(panel.getByRole('tab')).toHaveCount(1);
  await expect(panel.locator('.xterm-screen')).toBeVisible();
  const parallel = await page.evaluate(
    (scope) =>
      window.moose.request('commandStart', {
        ...scope,
        requestId: crypto.randomUUID(),
        command: 'printf alongside-terminal',
      }),
    scope,
  );
  await expect
    .poll(
      async () =>
        (await page.evaluate((id) => window.moose.request('commandRead', { id }), parallel.id))
          .status,
    )
    .toBe('completed');
  expect(
    (await page.evaluate((id) => window.moose.request('commandRead', { id }), parallel.id)).output,
  ).toBe('alongside-terminal');
  await panel.getByRole('button', { name: 'Close terminal', exact: true }).click();
  await expect(panel.getByRole('tab')).toHaveCount(0);
  expect(
    await page.evaluate((scope) => window.moose.request('terminalList', scope), scope),
  ).toEqual([]);
  const command = await page.evaluate(
    (scope) =>
      window.moose.request('commandStart', {
        ...scope,
        requestId: crypto.randomUUID(),
        command: 'printf released',
      }),
    scope,
  );
  await expect
    .poll(
      async () =>
        (await page.evaluate((id) => window.moose.request('commandRead', { id }), command.id))
          .status,
    )
    .toBe('completed');
  await app.close();
  app = await electron.launch({ args: ['.'], env: env() });
  const after = await app.firstWindow();
  await after.waitForSelector('.app-shell');
  expect(
    await after.evaluate((scope) => window.moose.request('terminalList', scope), scope),
  ).toEqual([]);
});

test('runs pnpm test alongside a terminal and preserves directory protection until both finish', async () => {
  const { page, root, scope } = await launch();
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ scripts: { test: 'node -e "console.log(\'TEST_COMMAND_OK\')"' } }),
  );
  await page.getByRole('button', { name: 'Background commands & schedules', exact: true }).click();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  await expect(page.locator('.terminal-screen')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  await page.evaluate(() => window.moose.request('settings', { theme: 'dark' }));
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.locator('.terminal-screen')).toHaveCSS(
    'background-color',
    await page.locator('.workspace').evaluate((el) => getComputedStyle(el).backgroundColor),
  );
  await page.screenshot({ path: 'test-results/terminal-catppuccin.png', animations: 'disabled' });
  await page.getByRole('tab', { name: 'Commands', exact: true }).click();
  await page.getByRole('textbox', { name: 'Shell command', exact: true }).fill('pnpm test');
  await page.getByRole('button', { name: 'Run command', exact: true }).click();
  await expect(page.getByTestId('command-output')).toContainText('TEST_COMMAND_OK');
  await expect(page.getByRole('region', { name: 'Command output' })).toContainText('completed');
  await expect(
    page.evaluate(
      (scope) => window.moose.request('deleteProject', { projectId: scope.projectId }),
      scope,
    ),
  ).rejects.toThrow('Stop the project tasks');
  const command = await page.evaluate(
    (scope) =>
      window.moose.request('commandStart', {
        ...scope,
        requestId: crypto.randomUUID(),
        command: 'read line; printf done',
      }),
    scope,
  );
  await page.getByRole('tab', { name: 'Terminal', exact: true }).click();
  await page.getByRole('button', { name: 'Close terminal', exact: true }).click();
  await expect(
    page.evaluate(
      (scope) => window.moose.request('deleteProject', { projectId: scope.projectId }),
      scope,
    ),
  ).rejects.toThrow('Stop the project tasks');
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  await expect(page.locator('.terminal-screen')).toBeVisible();
  await page.getByRole('button', { name: 'Close terminal', exact: true }).click();
  await expect(page.locator('.terminal-session-tab')).toHaveCount(0);
  await page.evaluate((id) => window.moose.request('commandStop', { id }), command.id);
  await page.evaluate(
    (scope) => window.moose.request('deleteProject', { projectId: scope.projectId }),
    scope,
  );
});

test('native shortcuts toggle and create terminals, switch tools and keep each tab one hover surface', async () => {
  const { page, scope } = await launch();
  async function shortcut(accelerator: string) {
    await app.evaluate(({ Menu }, accelerator) => {
      const item = Menu.getApplicationMenu()!
        .items.flatMap((item) => item.submenu?.items || [])
        .find((item) => item.accelerator === accelerator);
      if (!item) throw new Error(`Missing shortcut ${accelerator}`);
      item.click();
    }, accelerator);
  }
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    contents.sendInputEvent({ type: 'keyDown', keyCode: '`', modifiers: ['control'] });
    contents.sendInputEvent({ type: 'keyUp', keyCode: '`', modifiers: ['control'] });
  });
  await expect(page.locator('.terminal-screen')).toBeVisible();
  await expect(page.locator('.terminal-screen')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  const first = (
    await page.evaluate((scope) => window.moose.request('terminalList', scope), scope)
  )[0].id;
  await shortcut('Control+`');
  await expect(page.locator('.terminal-screen')).toHaveCount(0);
  await shortcut('Control+`');
  await expect(page.locator('.terminal-session-tab')).toHaveCount(1);
  expect(
    (await page.evaluate((scope) => window.moose.request('terminalList', scope), scope))[0].id,
  ).toBe(first);
  await shortcut('Control+Shift+`');
  await expect(page.locator('.terminal-session-tab')).toHaveCount(2);
  const tab = page.locator('.terminal-session-tab').last();
  await tab.getByRole('tab').hover();
  await expect(tab.getByRole('tab')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const background = await tab.evaluate((el) => getComputedStyle(el).backgroundColor);
  await tab.getByRole('button', { name: 'Close terminal' }).hover();
  await expect(tab.getByRole('button', { name: 'Close terminal' })).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  );
  await expect(tab).toHaveCSS('background-color', background);
  await page.screenshot({
    path: 'test-results/terminal-unified-hover.png',
    animations: 'disabled',
  });
  await shortcut('CmdOrCtrl+Shift+J');
  await expect(page.getByRole('textbox', { name: 'Shell command' })).toBeVisible();
  await shortcut('CmdOrCtrl+Shift+S');
  await expect(page.getByRole('button', { name: 'New schedule' })).toBeVisible();
  await shortcut('CmdOrCtrl+L');
  await expect(page.locator('#composer')).toBeFocused();
});
