import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import electronPath from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, realpath, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Store } from '../../electron/db/store';
let app: ElectronApplication | undefined, server: ChildProcess | undefined, root: string;
test.afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
  if (server && server.exitCode === null) {
    const done = once(server, 'exit');
    server.kill('SIGTERM');
    await done;
  }
  server = undefined;
  if (root) await rm(root, { recursive: true, force: true });
});
async function launch(web = false, count = 160) {
  root = await realpath(await mkdtemp(join(tmpdir(), 'moose-experience-')));
  const data = join(root, 'data'),
    projectPath = join(root, 'project');
  await mkdir(data);
  await mkdir(projectPath);
  await writeFile(join(projectPath, 'result.txt'), 'const result = "preview verified";');
  await writeFile(
    join(projectPath, 'image.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  const store = new Store(join(data, 'moose.sqlite'));
  store.setSettings({
    language: 'en',
    codexEnabled: false,
    grokEnabled: false,
    piEnabled: false,
    opencodeEnabled: false,
  });
  const project = store.addProject(projectPath),
    session = store.createSession(project.id, 'codex');
  store.updateSession(session.id, { title: 'UX history', draft: 'preserved draft' });
  let target = '';
  for (let i = 0; i < count; i++) {
    const id = randomUUID();
    if (i === 5) target = id;
    store.saveMessage({
      id,
      sessionId: session.id,
      runId: 'run',
      seq: 1,
      kind: 'assistant',
      state: 'done',
      title: '',
      text:
        i === 5
          ? '中文needle [result](result.txt)\n\n```ts\nconst a = 1;\n```\n\n![picture](image.png)'
          : `history needle ${i}`,
      createdAt: i + 1,
    });
  }
  const queued = store.createSession(project.id, 'codex');
  store.updateSession(queued.id, { title: 'Paused work', draft: 'queued draft' });
  store.enqueue(queued.id, 'do not automatically run');
  store.close();
  const env: Record<string, string> = Object.fromEntries(
    Object.entries({ ...process.env, MOOSE_DATA_DIR: data }).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  if (web) {
    server = spawn(String(electronPath), [resolve('dist-electron/web-server/web-server.js')], {
      env: { ...env, ELECTRON_RUN_AS_NODE: '1', MOOSE_WEB_DATA_DIR: data, MOOSE_WEB_PORT: '0' },
      stdio: 'pipe',
    });
    let info: { origin: string; token: string } | undefined;
    await expect
      .poll(async () => {
        try {
          info = JSON.parse(await readFile(join(data, 'connection.json'), 'utf8'));
          return true;
        } catch {
          return false;
        }
      })
      .toBe(true);
    app = await electron.launch({ args: [resolve('tests/fixtures/web-browser.cjs')], env });
    const page = await app.firstWindow();
    await page.goto(`${info!.origin}/#token=${info!.token}`);
    await expect(page.locator('.app-shell')).toBeVisible();
    return { page, session, queued, target, project };
  }
  app = await electron.launch({ args: ['.'], env });
  const page = await app.firstWindow();
  await expect(page.locator('.app-shell')).toBeVisible();
  return { page, session, queued, target, project };
}
async function search(page: Page, query: string) {
  await page.getByRole('button', { name: 'Search sessions', exact: true }).first().click();
  await page.getByRole('combobox', { name: 'Search sessions', exact: true }).fill(query);
}
for (const web of [false, true])
  test(`${web ? 'Web' : 'desktop'} searches old messages, previews local files, keeps errors and supports undo`, async () => {
    const { page, session, target } = await launch(web);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.locator('.session-row').filter({ hasText: 'UX history' }).click();
    await expect(page.locator('#composer')).toHaveValue('preserved draft');
    await search(page, 'needle');
    await expect(page.getByRole('option')).toHaveCount(50);
    await page.getByRole('button', { name: 'Load more', exact: true }).click();
    await expect(page.getByRole('option')).toHaveCount(100);
    await page.getByRole('button', { name: 'Load more', exact: true }).click();
    await expect(page.getByRole('option')).toHaveCount(150);
    await page.getByRole('combobox', { name: 'Search sessions', exact: true }).fill('中文needle');
    await expect(page.getByRole('option')).toHaveCount(1);
    await page.getByRole('combobox', { name: 'Search sessions', exact: true }).press('Enter');
    await expect(page.locator(`[id="message-${target}"]`)).toBeFocused();
    await page.getByRole('link', { name: 'result', exact: true }).click();
    const preview = page.locator('.file-preview-dialog');
    await expect(preview.locator('pre')).toContainText('preview verified');
    if (web) {
      const download = await page.evaluate(
        async (reference) => {
          const response = await fetch('/api/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reference),
          });
          return { status: response.status, text: await response.text() };
        },
        { projectId: session.projectId, path: 'result.txt' },
      );
      expect(download).toEqual({ status: 200, text: 'const result = "preview verified";' });
      expect(
        (
          await fetch(new URL('/api/download', page.url()), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: new URL(page.url()).origin },
            body: JSON.stringify({ projectId: session.projectId, path: 'result.txt' }),
          })
        ).status,
      ).toBe(401);
    } else {
      await app!.evaluate(
        ({ dialog }, path) => {
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
        },
        join(root, 'saved.txt'),
      );
      await preview.getByRole('button', { name: 'Save a copy', exact: true }).click();
      await expect
        .poll(() => readFile(join(root, 'saved.txt'), 'utf8'))
        .toBe('const result = "preview verified";');
      await app!.evaluate(
        ({ dialog }, path) => {
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
        },
        join(root, 'project', 'result.txt'),
      );
      await expect(
        page.evaluate((reference) => window.moose.request('fileDownload', reference), {
          projectId: session.projectId,
          path: 'result.txt',
        }),
      ).rejects.toThrow('different destination');
      expect(await readFile(join(root, 'project', 'result.txt'), 'utf8')).toContain(
        'preview verified',
      );
    }

    await page.keyboard.press('Escape');
    await expect(preview).toHaveCount(0);
    await page.getByRole('button', { name: 'Preview file picture', exact: true }).click();
    await expect(preview.locator('img')).toBeVisible();
    await preview.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect(preview.locator('img')).toHaveCSS('width', /\d+px/);
    await page.keyboard.press('Escape');
    await page
      .locator('.code-block')
      .getByRole('button', { name: 'Copy code', exact: true })
      .click();
    await expect(page.locator('.code-block')).toContainText('Copied');
    // An operation failure must survive unrelated snapshot refreshes.
    await page.evaluate(() => {
      const original = window.moose.request;
      window.moose.request = async (method, params) => {
        if (method === 'copyText') throw new Error('deliberate clipboard failure');
        return original(method, params);
      };
    });
    await page.locator('.code-block').getByRole('button', { name: 'Copied', exact: true }).click();
    await expect(page.locator('.workspace > .experience-error')).toBeVisible();
    await page.evaluate(() => window.moose.request('settings', { theme: 'dark', fontScale: 1.3 }));
    await expect(page.locator('.workspace > .experience-error')).toBeVisible();
    await page
      .locator('.workspace > .experience-error')
      .getByRole('button', { name: 'Dismiss', exact: true })
      .click();
    await page.getByRole('button', { name: 'Workspace tools', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.locator('.session-row').filter({ hasText: 'UX history' })).toBeVisible();
    expect(
      await page.evaluate(
        (id) =>
          window.moose
            .request('snapshot', {})
            .then((s) => s.sessions.find((x) => x.id === id)?.draft),
        session.id,
      ),
    ).toBe('preserved draft');
    await page.screenshot({ path: `test-results/experience-${web ? 'web' : 'desktop'}-dark.png` });
    expect(errors).toEqual([]);
  });
test('explains paused queues, confirms terminal end with cancel focused, and preserves queue pause on undo', async () => {
  const { page, queued, project } = await launch();
  await page.locator('.session-row').filter({ hasText: 'Paused work' }).click();
  await expect(page.locator('.waiting-reason')).toContainText('paused');
  await page.getByRole('button', { name: 'Workspace tools', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('pauses');
  await expect(
    page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeFocused();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(
    await page.evaluate(
      (sessionId) => window.moose.request('sessionActivity', { sessionId }),
      queued.id,
    ),
  ).toMatchObject({ queued: 1, reason: 'paused' });
  const terminal = await page.evaluate(
    (scope) =>
      window.moose.request('terminalStart', {
        ...scope,
        requestId: crypto.randomUUID(),
        cols: 80,
        rows: 24,
      }),
    { projectId: project.id, sessionId: queued.id },
  );
  await page.getByRole('button', { name: 'Background commands & schedules', exact: true }).click();
  await page.getByRole('button', { name: 'End terminal', exact: true }).click();
  await expect(
    page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeFocused();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(
    (
      await page.evaluate((scope) => window.moose.request('terminalList', scope), {
        projectId: project.id,
      })
    ).some((t) => t.id === terminal.id),
  ).toBe(true);
  await page.getByRole('button', { name: 'End terminal', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.locator('.terminal-session-tab')).toHaveCount(0);
});

test('Web notifications are opt-in, permission-aware, deduplicated and contain no message body', async () => {
  const { page, session } = await launch(true);
  const install = async (target: Page) =>
    target.evaluate(() => {
      const records: { title: string; body: string }[] = [];
      Reflect.set(window, 'testNotices', records);
      Reflect.set(window, 'testPermissionRequests', 0);
      class FakeNotification {
        static permission: NotificationPermission = 'denied';
        static async requestPermission() {
          Reflect.set(
            window,
            'testPermissionRequests',
            Number(Reflect.get(window, 'testPermissionRequests')) + 1,
          );
          return FakeNotification.permission;
        }
        onclick?: () => void;
        constructor(title: string, options: NotificationOptions) {
          records.push({ title, body: options.body || '' });
        }
        close() {}
      }
      Reflect.set(window, 'Notification', FakeNotification);
    });
  await install(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  expect(await page.evaluate(() => Reflect.get(window, 'testPermissionRequests'))).toBe(0);
  await page.getByRole('switch', { name: 'Task completion and failure', exact: true }).click();
  await expect(
    page.getByRole('switch', { name: 'Task completion and failure', exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByText(
      'Notifications are blocked. Allow Moose notifications in system or browser settings.',
    ),
  ).toBeVisible();
  await page.evaluate(() => Reflect.set(Notification, 'permission', 'granted'));
  await page.getByRole('switch', { name: 'Task completion and failure', exact: true }).click();
  await expect(
    page.getByRole('switch', { name: 'Task completion and failure', exact: true }),
  ).toBeChecked();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  const secondReady = app!.waitForEvent('window');
  await app!.evaluate(({ BrowserWindow }, url) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    void win.loadURL(url);
  }, page.url());
  const second = await secondReady;
  await expect(second.locator('.app-shell')).toBeVisible();
  await install(second);
  await second.evaluate(() => Reflect.set(Notification, 'permission', 'granted'));
  await page.evaluate(
    async ({ id, path }) => {
      await window.moose.request('settings', { codexEnabled: true, codexPath: path });
      await window.moose.request('send', {
        sessionId: id,
        text: 'inspect-input PRIVATE_NOTICE_BODY',
      });
    },
    { id: session.id, path: resolve('tests/fixtures/agent.mjs') },
  );
  await expect
    .poll(
      async () =>
        Number(await page.evaluate(() => Reflect.get(window, 'testNotices').length)) +
        Number(await second.evaluate(() => Reflect.get(window, 'testNotices').length)),
    )
    .toBe(1);
  const notices = [
    ...(await page.evaluate(() => Reflect.get(window, 'testNotices'))),
    ...(await second.evaluate(() => Reflect.get(window, 'testNotices'))),
  ];
  expect(JSON.stringify(notices)).not.toContain('PRIVATE_NOTICE_BODY');
  expect(notices[0].title).toContain('Task completed');
  await second.close();
});

test('keeps real terminal input and output responsive while searching 10,000 messages', async () => {
  const { page, project, session } = await launch(false, 10000);
  const result = await page.evaluate(
    async (scope) => {
      const terminal = await window.moose.request('terminalStart', {
        ...scope,
        requestId: crypto.randomUUID(),
        cols: 80,
        rows: 24,
      });
      const control = await window.moose.request('terminalControl', {
        id: terminal.id,
        action: 'acquire',
      });
      const started = performance.now();
      try {
        const searches = Array.from({ length: 10 }, (_, i) =>
          window.moose.request('searchMessages', { query: i % 2 ? 'needle' : 'absent' }),
        );
        await window.moose.request('terminalInput', {
          id: terminal.id,
          text: "printf '\\nUX_PONG\\n'\r",
          lease: control.lease!,
        });
        await Promise.all(searches);
        let found = false;
        while (performance.now() - started < 2000) {
          const output = await window.moose.request('terminalRead', { id: terminal.id, offset: 0 });
          if (output.data.includes('\r\nUX_PONG\r\n')) {
            found = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return { found, elapsed: performance.now() - started };
      } finally {
        await window.moose.request('terminalStop', { id: terminal.id });
      }
    },
    { projectId: project.id, sessionId: session.id },
  );
  expect(result.found).toBe(true);
  expect(result.elapsed).toBeLessThan(1000);
});
