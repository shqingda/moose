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
let peerApp: ElectronApplication | undefined;
let app: ElectronApplication | undefined, server: ChildProcess | undefined, root: string;
test.afterEach(async () => {
  await peerApp?.close().catch(() => {});
  peerApp = undefined;
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
  store.updateSession(session.id, {
    title: 'UX history',
    draft: 'preserved draft',
    status: 'completed',
  });
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
          ? `中文needle [result](result.txt) [result absolute](${join(projectPath, 'result.txt')})\n\n\`\`\`ts\nconst a = 1;\n\`\`\`\n\n![picture](image.png)`
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
  const input = page.getByRole('combobox', { name: 'Search sessions', exact: true });
  await expect(input).toBeFocused();
  await input.fill(query);
}
for (const web of [false, true])
  test(`${web ? 'Web' : 'desktop'} reopens a closing dialog and keeps reduced-motion feedback`, async () => {
    const { page } = await launch(web, 0);
    const trigger = page.getByRole('button', { name: 'Search sessions', exact: true }).first();
    const popup = page.locator('.search-dialog');
    const accessibility = await page.context().newCDPSession(page);
    for (const reduced of [false, true]) {
      await accessibility.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }],
      });
      // Isolate the preference under test from this Mac's own accessibility settings.
      await page.evaluate(
        (value) => document.documentElement.classList.toggle('reduce-motion', value),
        reduced,
      );
      await trigger.click();
      await expect(popup).toHaveCSS('opacity', '1');
      const close = popup.getByRole('button', { name: 'Close', exact: true });
      const target = await close.boundingBox();
      expect(target!.width).toBeGreaterThanOrEqual(32);
      expect(target!.height).toBeGreaterThanOrEqual(32);
      const interrupted = await popup.evaluate(async (element) => {
        element.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')!.click();
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        const closing = element.hasAttribute('data-ending-style');
        const transform = getComputedStyle(element).transform;
        const transition = getComputedStyle(element).transitionProperty;
        // Bypass the automation stability wait so this reopens during the exit transition.
        const search = [
          ...document.querySelectorAll<HTMLButtonElement>('.sidebar-actions button'),
        ].find((button) => button.textContent?.includes('Search sessions'))!;
        search.click();
        await new Promise(requestAnimationFrame);
        return {
          closing,
          transform,
          transition,
          reused: document.querySelector('.search-dialog') === element,
        };
      });
      expect(interrupted.closing).toBe(true);
      expect(interrupted.reused).toBe(true);
      if (reduced) {
        expect(interrupted.transform).toBe('none');
        expect(interrupted.transition).toBe('opacity');
      }
      await expect(popup).toHaveCSS('opacity', '1');
      await expect(popup).not.toHaveAttribute('data-ending-style');
      await close.click();
      await expect(popup).toHaveCount(0);
      await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
  });

for (const web of [false, true])
  test(`${web ? 'Web' : 'desktop'} searches old messages, previews local files, keeps errors and supports undo`, async () => {
    const { page, session, target } = await launch(web);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.locator('.session-row').filter({ hasText: 'UX history' }).click();
    await expect(page.locator('#composer')).toHaveValue('preserved draft');
    await search(page, 'needle');
    await expect(page.getByRole('option')).toHaveCount(50);
    const searchInput = page.getByRole('combobox', { name: 'Search sessions', exact: true });
    await searchInput.press('ArrowDown');
    const selected = page.getByRole('option').nth(1);
    await expect(selected).toHaveAttribute('aria-selected', 'true');
    await expect(selected).not.toHaveCSS('box-shadow', 'none');
    await expect(searchInput).toHaveAttribute('aria-activedescendant', 'search-hit-1');
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    await expect(searchInput).toHaveValue('');
    await expect(searchInput).toBeFocused();
    await searchInput.fill('needle');
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
    const preview = page.locator('.files-frame[aria-hidden="false"] .files-panel');
    await expect(preview.locator('[data-code]')).toContainText('preview verified');
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
    await expect(
      page.locator('.code-block').getByRole('button', { name: 'Copied', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.code-block-language')).toHaveText('TypeScript');
    await page.locator('.code-block').getByRole('button', { name: 'Wrap code' }).click();
    await expect(page.locator('.code-block pre')).toHaveCSS('white-space', 'pre-wrap');
    expect(await app!.evaluate(({ clipboard }) => clipboard.readText())).toBe('const a = 1;\n');
    await page.locator('.code-block').getByRole('button', { name: 'Wrap code' }).click();
    await page.locator('.code-block').getByRole('button', { name: 'Wrap code' }).blur();
    await page.mouse.move(0, 0);
    await expect(
      page.locator('.code-block').getByRole('button', { name: 'Copy code', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page
      .locator('.code-block')
      .screenshot({ path: `test-results/code-card-${web ? 'web' : 'desktop'}.png` });
    // An operation failure must survive unrelated snapshot refreshes.
    await page.evaluate(() => {
      const original = window.moose.request;
      window.moose.request = async (method, params) => {
        if (method === 'copyText') throw new Error('deliberate clipboard failure');
        return original(method, params);
      };
    });
    await page
      .locator('.code-block')
      .getByRole('button', { name: 'Copy code', exact: true })
      .click();
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

for (const web of [false, true])
  test(`${web ? 'Web' : 'desktop'} browses workspace files in a side panel and keeps tabs and drafts`, async () => {
    const { page } = await launch(web, 8);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && /worker|Content Security Policy/i.test(message.text()))
        errors.push(message.text());
    });
    await mkdir(join(root, 'project', 'src'));
    await writeFile(
      join(root, 'project', 'src', 'hello.ts'),
      'export function hello(name: string) {\n  return `Hello, ${name}!`;\n}\n' +
        Array.from({ length: 700 }, (_, index) => `// preview line ${index}\n`).join(''),
    );
    await page.locator('.session-row').filter({ hasText: 'UX history' }).click();
    await page.mouse.move(0, 0);
    const row = page.locator('.session-row').filter({ hasText: 'UX history' });
    await expect(row.locator('.session-status')).toHaveCount(0);
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    const panel = page.locator('.files-frame[aria-hidden="false"] .files-panel');
    await panel.getByRole('treeitem', { name: 'src', exact: true }).click();
    await panel.getByRole('treeitem', { name: 'hello.ts', exact: true }).click();
    await expect(panel.locator('[data-code]')).toContainText('export function hello');
    await expect(panel.locator('[data-line-number-content]').first()).toHaveText('1');
    await expect(page.locator('.file-preview-dialog')).toHaveCount(0);
    await panel.getByRole('treeitem', { name: 'result.txt', exact: true }).click();
    await page.getByRole('link', { name: 'result absolute', exact: true }).click();
    await expect(panel.getByRole('tab')).toHaveCount(2);
    await panel.getByRole('tab', { name: 'hello.ts', exact: true }).click();
    await expect(panel.locator('[data-code]')).toContainText('Hello,');
    const code = panel.locator('.pierre-code-view');
    await code.focus();
    await code.press('ControlOrMeta+f');
    const find = panel.getByRole('textbox', { name: 'Find in file', exact: true });
    await expect(find).toBeFocused();
    await find.fill('preview line 650');
    await expect(panel.locator('.code-find-bar [role="status"]')).toHaveText('1/1');
    await expect(panel.locator('[data-code]')).toContainText('preview line 650');
    await expect.poll(() => code.evaluate((element) => element.scrollTop)).toBeGreaterThan(1000);
    await find.press('Escape');
    await expect(find).toHaveCount(0);
    await expect(panel).toBeVisible();
    const scrollTop = await code.evaluate((element) => element.scrollTop);
    await panel.getByRole('tab', { name: 'result.txt', exact: true }).click();
    await expect(panel.locator('[data-code]')).toContainText('preview verified');
    await panel.getByRole('tab', { name: 'hello.ts', exact: true }).click();
    await expect(panel.locator('[data-code]')).toContainText('preview line 650');
    await expect
      .poll(async () => Math.abs((await code.evaluate((element) => element.scrollTop)) - scrollTop))
      .toBeLessThan(3);
    await code.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(panel.locator('[data-code]')).toContainText('export function hello');
    const checkTabHover = async (theme: string) => {
      const tab = panel
        .locator('.file-tab')
        .filter({ has: page.getByRole('tab', { name: 'hello.ts', exact: true }) });
      const filename = tab.getByRole('tab');
      const close = tab.getByRole('button', { name: 'Close file hello.ts', exact: true });
      await page.mouse.move(0, 0);
      await tab.evaluate((element) =>
        element.getAnimations().forEach((animation) => animation.finish()),
      );
      const background = await tab.evaluate((element) => getComputedStyle(element).backgroundColor);
      await filename.hover();
      await tab.evaluate((element) =>
        element.getAnimations().forEach((animation) => animation.finish()),
      );
      await expect(tab).not.toHaveCSS('background-color', background);
      const hovered = await tab.evaluate((element) => getComputedStyle(element).backgroundColor);
      await expect(filename).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await close.hover();
      await expect(tab).toHaveCSS('background-color', hovered);
      await expect(close).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await tab.hover({ position: { x: 1, y: 1 } });
      await expect(tab).toHaveCSS('background-color', hovered);
      await tab.screenshot({
        path: `test-results/file-tab-hover-${web ? 'web' : 'desktop'}-${theme}.png`,
      });
    };
    await checkTabHover('light');
    await panel.getByRole('button', { name: 'File tree', exact: true }).click();
    await expect(panel.getByRole('tree')).toHaveCount(0);
    await panel.getByRole('button', { name: 'Wrap code', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Wrap code', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await panel.getByRole('button', { name: 'File tree', exact: true }).click();
    await panel.getByRole('textbox', { name: 'Find files…', exact: true }).fill('hello');
    await expect(panel.getByRole('treeitem')).toHaveCount(1);
    await expect(panel.getByRole('treeitem')).toContainText('src/hello.ts');
    await panel.getByRole('textbox', { name: 'Find files…', exact: true }).fill('');
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('link', { name: 'result', exact: true }).click();
    await expect(panel.getByRole('tab', { name: 'result.txt', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(panel.getByRole('tab')).toHaveCount(2);
    await panel.getByRole('tab', { name: 'hello.ts', exact: true }).click();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `test-results/files-${web ? 'web' : 'desktop'}.png` });
    await page.evaluate(() => window.moose.request('settings', { theme: 'dark' }));
    await expect(panel.locator('diffs-container')).toHaveCSS('color-scheme', 'dark');
    await expect(panel.getByRole('treeitem').first()).toHaveCSS('color', 'rgb(245, 245, 247)');
    await checkTabHover('dark');
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `test-results/files-${web ? 'web' : 'desktop'}-dark.png` });
    await rm(join(root, 'project', 'src', 'hello.ts'));
    await panel.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('no longer exists');
    await panel.getByRole('button', { name: 'Close file hello.ts', exact: true }).click();
    await expect(panel.locator('[data-code]')).toContainText('preview verified');
    await expect(page.locator('#composer')).toHaveValue('preserved draft');
    if (web) {
      await page.setViewportSize({ width: 640, height: 800 });
      await page.locator('.web-sidebar-backdrop').click({ position: { x: 600, y: 100 } });
      await expect(page.locator('.sidebar-frame')).toHaveCSS('width', '0px');
      await expect(panel).toHaveCSS('width', '640px');
      await panel.getByRole('button', { name: 'File tree', exact: true }).click();
      await page.mouse.move(0, 0);
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      await page.screenshot({ path: 'test-results/files-web-narrow.png' });
    }
    expect(errors).toEqual([]);
  });

for (const web of [false, true])
  test(`${web ? 'Web' : 'desktop'} expands files and previews Markdown by default`, async () => {
    const { page } = await launch(web, 8);
    await mkdir(join(root, 'project', 'docs'));
    await writeFile(
      join(root, 'project', 'docs', 'README.md'),
      '# Project guide\n\nA **Markdown** preview.\n\n| Name | Value |\n| --- | --- |\n| Example | 42 |\n\n- [x] Complete\n\n[Next page](other.md)\n\n![Local image](../image.png)\n\n```ts\nconst answer = 42;\n```\n',
    );
    await writeFile(
      join(root, 'project', 'docs', 'other.md'),
      '# Other page\n\n[Back](README.md)\n',
    );
    await page.locator('.session-row').filter({ hasText: 'UX history' }).click();
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    const panel = page.locator('.files-frame[aria-hidden="false"] .files-panel');
    await panel.getByRole('treeitem', { name: 'docs', exact: true }).click();
    await panel.getByRole('treeitem', { name: 'README.md', exact: true }).click();
    const preview = panel.locator('.file-markdown-preview');
    await expect(preview.getByRole('heading', { name: 'Project guide' })).toBeVisible();
    await expect(preview.getByRole('table')).toContainText('42');
    await expect(preview.getByRole('checkbox')).toBeChecked();
    await expect(preview.getByRole('img', { name: 'Local image' })).toBeVisible();
    await panel.getByRole('button', { name: 'View source', exact: true }).click();
    await expect(panel.locator('[data-code]')).toContainText('# Project guide');
    await expect(preview).toHaveCount(0);
    await panel.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(preview.getByRole('heading', { name: 'Project guide' })).toBeVisible();
    const previousWidth = (await panel.boundingBox())!.width;
    await panel.getByRole('button', { name: 'Expand file panel', exact: true }).click();
    await expect(page.locator('main.workspace')).toBeHidden();
    await expect
      .poll(async () => (await panel.boundingBox())!.width)
      .toBeGreaterThan(previousWidth + 100);
    await expect(panel.getByRole('separator')).toHaveCount(0);
    await preview.getByRole('link', { name: 'Next page' }).click();
    await expect(preview.getByRole('heading', { name: 'Other page' })).toBeVisible();
    await preview.getByRole('link', { name: 'Back' }).click();
    await expect(preview.getByRole('heading', { name: 'Project guide' })).toBeVisible();
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: `test-results/markdown-expanded-${web ? 'web' : 'desktop'}.png`,
    });
    await panel.getByRole('button', { name: 'Restore split view', exact: true }).click();
    await expect(page.locator('main.workspace')).toBeVisible();
    await expect
      .poll(async () => Math.abs((await panel.boundingBox())!.width - previousWidth))
      .toBeLessThan(2);
    await expect(page.locator('#composer')).toHaveValue('preserved draft');
    await panel.getByRole('button', { name: 'Expand file panel', exact: true }).click();
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('main.workspace')).toBeVisible();
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await expect(
      panel.getByRole('button', { name: 'Expand file panel', exact: true }),
    ).toBeVisible();
  });

for (const web of [false, true]) {
  test(`${web ? 'Web' : 'desktop'} preserves failed settings input and exposes safe recovery actions`, async () => {
    const { page } = await launch(web);
    if (!web) {
      const permission = await page.evaluate(() =>
        window.moose.request('notificationPermission', {}),
      );
      expect(['default', 'granted', 'denied']).toContain(permission);
    }
    await page.evaluate(() => {
      const original = window.moose.request;
      Reflect.set(window, 'saveAttempts', 0);
      window.moose.request = async (method, args) => {
        if (method === 'settings' && 'codexPath' in args) {
          Reflect.set(window, 'saveAttempts', Number(Reflect.get(window, 'saveAttempts')) + 1);
          throw Object.assign(new Error('Explicit authentication failure'), { code: 'auth' });
        }
        return original(method, args);
      };
    });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page
      .locator('.settings-navigation')
      .getByRole('button', { name: 'Agent connections', exact: true })
      .click();
    const row = page.locator('.provider-card').first();
    await row.locator('.provider-row').click();
    await row.locator('#codexPath').fill('/missing/keep-my-path');
    await page.getByRole('heading', { name: 'Agent connections', exact: true }).click();
    await expect(
      row.getByText('Could not save. Your input is kept.', { exact: true }),
    ).toBeVisible();
    await expect(row.locator('#codexPath')).toHaveValue('/missing/keep-my-path');
    await page.screenshot({
      path: `test-results/settings-error-${web ? 'web' : 'desktop'}.png`,
      animations: 'disabled',
      mask: [page.locator('.provider-resolved-path')],
      maskColor: '#cccccc',
    });
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    const error = page.locator('.workspace > .experience-error');
    await expect(
      error.getByRole('button', { name: 'Connect an agent', exact: true }),
    ).toBeVisible();
    await expect(error.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
    await error.getByRole('button', { name: 'Connect an agent', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Agent connections', exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => Reflect.get(window, 'saveAttempts'))).toBe(1);
  });

  test(`${web ? 'Web' : 'desktop'} pauses archive undo for pointer and keyboard without consuming its timeout`, async () => {
    const { page } = await launch(web);
    await page.locator('.session-row').filter({ hasText: 'UX history' }).click();
    await page.clock.install();
    await page.getByRole('button', { name: 'Workspace tools', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
    const undo = page.locator('.archive-undo');
    await expect(undo).toBeVisible();
    await undo.hover();
    await page.clock.fastForward(15000);
    await expect(undo).toBeVisible();
    await undo.getByRole('button', { name: 'Undo', exact: true }).focus();
    await page.mouse.move(0, 0);
    await page.clock.fastForward(15000);
    await expect(undo).toBeVisible();
    await undo.getByRole('button', { name: 'Undo', exact: true }).blur();
    await page.clock.fastForward(10001);
    await expect(undo).toHaveCount(0);
  });
}

test('desktop and Web share notification ownership, restore click targets and suppress the foreground session', async () => {
  const { page, session } = await launch(true);
  await page.evaluate(() => {
    Reflect.set(window, 'noticeCount', 0);
    class FakeNotification {
      static permission = 'granted';
      constructor() {
        Reflect.set(window, 'noticeCount', Number(Reflect.get(window, 'noticeCount')) + 1);
      }
      close() {}
    }
    Reflect.set(window, 'Notification', FakeNotification);
  });
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      MOOSE_DATA_DIR: join(root, 'desktop-client'),
      MOOSE_SHARED_RUNTIME_FILE: join(root, 'data/connection.json'),
    }).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  peerApp = await electron.launch({ args: ['.'], env });
  const desktop = await peerApp.firstWindow();
  await expect(desktop.locator('.app-shell')).toBeVisible();
  // Real main process/IPC/notification ownership; OS delivery is replaced, not the coordinator.
  await peerApp.evaluate(({ Notification }, path) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(process.cwd() + '/package.json');
    require(path).permission = async () => 'granted';
    Reflect.set(globalThis, 'noticeCount', 0);
    Notification.prototype.show = function () {
      Reflect.set(globalThis, 'noticeCount', Number(Reflect.get(globalThis, 'noticeCount')) + 1);
      Reflect.set(globalThis, 'lastNotice', this);
    };
  }, resolve('dist-native/notifications.node'));
  // Force the first delivery to desktop so the native click path can be checked.
  await page.evaluate(() => Reflect.set(Notification, 'permission', 'denied'));
  await page.evaluate(
    async ({ id, path }) => {
      await window.moose.request('settings', {
        notifyResults: true,
        codexEnabled: true,
        codexPath: path,
      });
      await window.moose.request('send', {
        sessionId: id,
        text: 'inspect-input PRIVATE_MIXED_NOTICE',
      });
    },
    { id: session.id, path: resolve('tests/fixtures/agent.mjs') },
  );
  await expect
    .poll(() => peerApp!.evaluate(() => Number(Reflect.get(globalThis, 'noticeCount'))))
    .toBe(1);
  await peerApp.evaluate(() => Reflect.get(globalThis, 'lastNotice').emit('click'));
  await expect(desktop.locator('.session-row[aria-current="page"]')).toContainText('UX history');
  const body = await peerApp.evaluate(() => Reflect.get(globalThis, 'lastNotice').body);
  expect(body).not.toContain('PRIVATE_MIXED_NOTICE');
  await peerApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  await desktop.evaluate(() => window.moose.request('clientPresence', { focused: false }));
  await page.evaluate(() => Reflect.set(Notification, 'permission', 'granted'));
  await page.evaluate(
    (id) => window.moose.request('send', { sessionId: id, text: 'inspect-input second' }),
    session.id,
  );
  const count = async () =>
    Number(await peerApp!.evaluate(() => Reflect.get(globalThis, 'noticeCount'))) +
    Number(await page.evaluate(() => Reflect.get(window, 'noticeCount')));
  await expect.poll(count).toBe(2);
  await peerApp.evaluate(({ BrowserWindow, app }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.show();
    app.focus({ steal: true });
    win.focus();
  });
  await expect
    .poll(() =>
      peerApp!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused()),
    )
    .toBe(true);
  await desktop.evaluate(
    (id) => window.moose.request('clientPresence', { focused: true, sessionId: id }),
    session.id,
  );
  await page.evaluate(
    (id) => window.moose.request('send', { sessionId: id, text: 'inspect-input foreground' }),
    session.id,
  );
  await expect(desktop.locator('.markdown').last()).toContainText('foreground');
  await page.waitForTimeout(300);
  expect(await count()).toBe(2);
});

for (const web of [false, true])
  test(`${web ? 'Web' : 'desktop'} keeps historical reading during streaming and never repeats an uncertain write`, async () => {
    const { page, session, target } = await launch(web);
    await page.evaluate(() => {
      const original = window.moose.subscribe;
      const listeners = new Set<Parameters<typeof window.moose.subscribe>[0]>();
      Reflect.set(window, 'historyListeners', listeners);
      window.moose.subscribe = (callback) => {
        listeners.add(callback);
        const stop = original(callback);
        return () => {
          listeners.delete(callback);
          stop();
        };
      };
    });
    await page.locator('.session-row').filter({ hasText: 'UX history' }).click();
    await search(page, '中文needle');
    await expect(page.getByRole('option')).toHaveCount(1);
    await page.getByRole('combobox', { name: 'Search sessions' }).press('Enter');
    const found = page.locator(`[id="message-${target}"]`);
    await expect(found).toBeFocused();
    const before = await found.boundingBox();
    await page.evaluate((sessionId) => {
      for (let seq = 1; seq <= 20; seq++) {
        const event = {
          type: 'message',
          message: {
            id: 'new-stream',
            sessionId,
            runId: 'new',
            seq,
            position: 1000,
            kind: 'assistant',
            state: 'running',
            text: 'new stream ' + seq,
            title: '',
            createdAt: Date.now(),
          },
        };
        for (const fn of Reflect.get(window, 'historyListeners')) fn(event);
      }
    }, session.id);
    await expect(page.locator('#message-new-stream')).toHaveCount(0);
    expect(Math.abs((await found.boundingBox())!.y - before!.y)).toBeLessThan(2);
    await page.evaluate(() => {
      const original = window.moose.request;
      Reflect.set(window, 'writeAttempts', 0);
      window.moose.request = async (method, params) => {
        if (method === 'copyText') {
          Reflect.set(window, 'writeAttempts', Number(Reflect.get(window, 'writeAttempts')) + 1);
          throw Object.assign(new Error('Write result unknown'), { code: 'uncertain' });
        }
        return original(method, params);
      };
    });
    await found.getByRole('button', { name: 'Copy code', exact: true }).click();
    const error = page.locator('.workspace > .experience-error');
    await expect(error.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
    await error.getByRole('button', { name: 'Check status', exact: true }).click();
    await expect(error).toBeVisible();
    expect(await page.evaluate(() => Reflect.get(window, 'writeAttempts'))).toBe(1);
    await expect(page.locator('#composer')).toHaveValue('preserved draft');
  });

test('desktop asks permission only on opt-in and keeps denied notifications disabled', async () => {
  const { page } = await launch();
  await app!.evaluate((_, path) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(process.cwd() + '/package.json');
    Reflect.set(globalThis, 'permissionRequests', 0);
    Reflect.set(globalThis, 'permissionResult', 'denied');
    require(path).permission = async (request: boolean) => {
      if (request)
        Reflect.set(
          globalThis,
          'permissionRequests',
          Number(Reflect.get(globalThis, 'permissionRequests')) + 1,
        );
      return request ? Reflect.get(globalThis, 'permissionResult') : 'default';
    };
  }, resolve('dist-native/notifications.node'));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  expect(await app!.evaluate(() => Reflect.get(globalThis, 'permissionRequests'))).toBe(0);
  const toggle = page.getByRole('switch', { name: 'Task completion and failure', exact: true });
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(
    page.getByText(
      'Notifications are blocked. Allow Moose notifications in system or browser settings.',
    ),
  ).toBeVisible();
  expect(await app!.evaluate(() => Reflect.get(globalThis, 'permissionRequests'))).toBe(1);
  await app!.evaluate(() => Reflect.set(globalThis, 'permissionResult', 'granted'));
  await toggle.click();
  await expect(toggle).toBeChecked();
  expect(await app!.evaluate(() => Reflect.get(globalThis, 'permissionRequests'))).toBe(2);
});

test('shares panel width and focus, reverses motion smoothly, and respects accessibility settings', async () => {
  const { page } = await launch(true, 160);
  await page.locator('.session-row').filter({ hasText: 'UX history' }).click();
  const trigger = page.getByRole('button', { name: 'Files', exact: true });
  await trigger.focus();
  await trigger.press('Enter');
  const panel = page.locator('.files-frame[aria-hidden="false"] .files-panel');
  await expect(panel).toBeFocused();
  const separator = panel.getByRole('separator');
  const initial = Number(await separator.getAttribute('aria-valuenow'));
  await separator.focus();
  await separator.press('ArrowLeft');
  await expect(separator).toHaveAttribute('aria-valuenow', String(initial + 16));
  await separator.press('Escape');
  await expect(trigger).toBeFocused();
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await expect(page.locator('.review-frame:not(.files-frame) [role="separator"]')).toHaveAttribute(
    'aria-valuenow',
    String(initial + 16),
  );
  await page.locator('.review-panel:not(.files-panel)').press('Escape');
  await expect(page.getByRole('button', { name: 'Review changes', exact: true })).toBeFocused();
  await trigger.click();
  await expect
    .poll(async () =>
      Math.abs((await page.locator('.files-frame').boundingBox())!.width - (initial + 16)),
    )
    .toBeLessThan(1);
  const frames = await page.evaluate(async () => {
    const button = document.querySelector<HTMLButtonElement>('button[aria-label="Files"]')!;
    const frame = document.querySelector('.files-frame')!;
    const points: number[] = [frame.getBoundingClientRect().width];
    const start = performance.now();
    let reversed = false;
    button.click();
    while (performance.now() - start < 800) {
      await new Promise(requestAnimationFrame);
      points.push(frame.getBoundingClientRect().width);
      if (!reversed && performance.now() - start >= 90) {
        button.click();
        reversed = true;
      }
    }
    return points;
  });
  expect(Math.min(...frames)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...frames)).toBeLessThanOrEqual(initial + 17);
  expect(Math.min(...frames)).toBeLessThan(initial - 30);
  expect(Math.abs(frames.at(-1)! - (initial + 16))).toBeLessThan(1);
  for (let i = 1; i < frames.length; i++)
    expect(Math.abs(frames[i] - frames[i - 1])).toBeLessThan((initial + 16) * 0.4);
  await test.info().attach('panel-reversal-frames', {
    body: JSON.stringify({ unit: 'CSS pixels', width: initial + 16, frames }, null, 2),
    contentType: 'application/json',
  });
  await page.locator('.files-panel').getByRole('button', { name: 'Close', exact: true }).click();
  const accessibility = await page.context().newCDPSession(page);
  await accessibility.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-reduced-motion', value: 'reduce' },
      { name: 'prefers-reduced-transparency', value: 'reduce' },
      { name: 'prefers-contrast', value: 'more' },
    ],
  });
  await page.evaluate(() => window.moose.request('settings', { fontScale: 1.2 }));
  await expect(page.locator('html')).toHaveClass(/reduce-motion/);
  await expect(page.locator('.files-frame')).toHaveCSS('transition-duration', '1e-05s');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCSS('backdrop-filter', 'none');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('#composer')).toHaveValue('preserved draft');
  await expect(page.locator('#composer')).toHaveCSS('font-size', '19.2px');
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(430, 780));
  await page.locator('.global-sidebar-toggle button').click();
  await trigger.click();
  const box = (await panel.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(430);
  expect(box.width).toBeGreaterThan(400);
  await panel.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(page.locator('#composer')).toHaveValue('preserved draft');
});

for (const web of [false, true])
  test(`${web ? 'Web' : 'desktop'} keeps rapid auxiliary panel switches bounded and preserves focus, file tabs and draft`, async () => {
    const { page } = await launch(web, 20);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.locator('.session-row').filter({ hasText: 'UX history' }).click();
    const files = page.getByRole('button', { name: 'Files', exact: true });
    await files.click();
    await page.getByRole('treeitem', { name: 'result.txt', exact: true }).click();
    await expect(page.locator('.files-panel [data-code]')).toContainText('preview verified');
    const width = Number(
      await page.locator('.files-panel').getByRole('separator').getAttribute('aria-valuenow'),
    );
    await expect
      .poll(async () => (await page.locator('.files-frame').boundingBox())!.width)
      .toBeCloseTo(width, 0);
    const accessibility = await page.context().newCDPSession(page);
    for (const reduced of [false, true]) {
      if (!web)
        await app!.evaluate(({ systemPreferences, nativeTheme }, reduced) => {
          // Override only this isolated process's native preference reader, never macOS settings.
          const settings = systemPreferences.getAnimationSettings();
          systemPreferences.getAnimationSettings = () => ({
            ...settings,
            prefersReducedMotion: reduced,
          });
          nativeTheme.emit('updated');
        }, reduced);
      await accessibility.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }],
      });
      if (reduced) await expect(page.locator('html')).toHaveClass(/reduce-motion/);
      else await expect(page.locator('html')).not.toHaveClass(/reduce-motion/);
      const samples = await page.evaluate(async () => {
        const files = document.querySelector<HTMLButtonElement>('button[aria-label="Files"]')!;
        const review = document.querySelector<HTMLButtonElement>(
          'button[aria-label="Review changes"]',
        )!;
        const filesFrame = document.querySelector<HTMLElement>('.files-frame')!;
        const reviewFrame = document.querySelector<HTMLElement>('.review-frame:not(.files-frame)')!;
        const points = [];
        const actions = [];
        const start = performance.now();
        let switches = 0;
        let lastSwitch = start - 60;
        while (switches < 12 || performance.now() - lastSwitch < 800) {
          await new Promise(requestAnimationFrame);
          const now = performance.now();
          points.push({
            ms: now - start,
            filesWidth: filesFrame.getBoundingClientRect().width,
            reviewWidth: reviewFrame.getBoundingClientRect().width,
            active: [filesFrame, reviewFrame].filter(
              (frame) => frame.getAttribute('aria-hidden') === 'false',
            ).length,
            hiddenFocus: !!document.activeElement?.closest('[inert], [aria-hidden="true"]'),
          });
          if (switches < 12 && now - lastSwitch >= 60) {
            const target = switches % 2 === 0 ? review : files;
            // DOM focus/click bypass Playwright's stability wait so transitions overlap.
            target.focus();
            target.click();
            actions.push({ ms: now - start, target: switches % 2 === 0 ? 'review' : 'files' });
            switches++;
            lastSwitch = now;
          }
        }
        return { points, actions };
      });
      await test.info().attach(`rapid-panel-switches-${reduced ? 'reduced' : 'normal'}`, {
        body: JSON.stringify(
          { host: web ? 'web' : 'desktop', width, reduced, ...samples },
          null,
          2,
        ),
        contentType: 'application/json',
      });
      expect(samples.actions).toHaveLength(12);
      for (const sample of samples.points) {
        expect(sample.active).toBe(1);
        expect(sample.hiddenFocus).toBe(false);
        expect(sample.filesWidth).toBeGreaterThanOrEqual(0);
        expect(sample.reviewWidth).toBeGreaterThanOrEqual(0);
        expect(sample.filesWidth).toBeLessThanOrEqual(width + 1);
        expect(sample.reviewWidth).toBeLessThanOrEqual(width + 1);
      }
      expect(samples.points.at(-1)!.filesWidth).toBeCloseTo(width, 0);
      expect(samples.points.at(-1)!.reviewWidth).toBeLessThan(1);
      if (reduced) {
        for (const action of samples.actions) {
          // Allow the React commit and following animation frame, then require the endpoint.
          const settled = samples.points.filter((sample) => sample.ms > action.ms).slice(2, 3)[0]!;
          expect(settled.filesWidth).toBeCloseTo(action.target === 'files' ? width : 0, 0);
          expect(settled.reviewWidth).toBeCloseTo(action.target === 'review' ? width : 0, 0);
        }
      }
      await expect(page.locator('.files-panel')).toBeFocused();
      await expect(files).toHaveAttribute('aria-pressed', 'true');
      await expect(
        page.getByRole('button', { name: 'Review changes', exact: true }),
      ).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('.files-panel [role="tab"]')).toHaveCount(1);
      await expect(page.locator('.files-panel [data-code]')).toContainText('preview verified');
      await page.locator('.files-panel').press('Escape');
      await expect(files).toBeFocused();
      await expect(page.locator('#composer')).toHaveValue('preserved draft');
      if (!reduced) {
        await files.press('Enter');
        await expect
          .poll(async () => (await page.locator('.files-frame').boundingBox())!.width)
          .toBeCloseTo(width, 0);
      }
    }
    expect(errors).toEqual([]);
  });
