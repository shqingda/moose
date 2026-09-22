import { request as httpRequest } from 'node:http';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import electronPath from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../../electron/db/store';
let app: ElectronApplication,
  desktop: ElectronApplication | undefined,
  child: ChildProcess,
  dir: string;
test.afterEach(async () => {
  await desktop?.close().catch(() => {});
  desktop = undefined;
  await app?.close().catch(() => {});
  if (child && child.exitCode === null) {
    const exit = once(child, 'exit');
    child.kill('SIGTERM');
    await exit;
  }
  if (dir) await rm(dir, { recursive: true, force: true });
});
test('browser login, project selection, OpenCode approval and terminal survive page reconnect', async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'moose-web-e2e-')));
  const root = join(dir, 'repo');
  await mkdir(root);
  const store = new Store(join(dir, 'moose.sqlite'));
  store.setSettings({
    language: 'en',
    theme: 'light',
    codexEnabled: false,
    grokEnabled: false,
    piEnabled: false,
    opencodeEnabled: true,
    opencodePath: resolve('tests/fixtures/opencode.mjs'),
  });
  store.close();
  child = spawn(electronPath as unknown as string, ['dist-electron/web-server/web-server.js'], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      MOOSE_WEB_DATA_DIR: dir,
      MOOSE_WEB_PORT: '0',
      MOOSE_WEB_PUBLIC_ORIGIN: 'https://preview.example.test',
      MOOSE_WEB_DIRECTORY_PICKER: 'browse',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout!.on('data', (data) => (output += data));
  child.stderr!.on('data', (data) => (output += data));
  await expect.poll(() => output, { timeout: 15000 }).toContain('Moose Web:');
  const url = output.match(/Moose Web: (\S+)/)![1];
  const origin = new URL(url).origin;
  const localhostURL = output.match(/Moose Web \(localhost\): (\S+)/)![1];
  expect(new URL(localhostURL).hostname).toBe('localhost');
  expect((await fetch(new URL(localhostURL).origin)).status).toBe(200);
  const denied = await fetch(origin + '/api/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ method: 'snapshot', params: {} }),
  });
  expect(denied.status).toBe(401);
  const cross = await fetch(origin + '/api/login', {
    method: 'POST',
    headers: { Origin: 'https://evil.invalid', 'Content-Type': 'application/json' },
    body: '{}',
  });
  expect(cross.status).toBe(403);
  const publicHeaders = {
    Host: 'preview.example.test',
    Origin: 'https://preview.example.test',
    'Content-Type': 'application/json',
  };
  const publicRequest = (path: string, headers: Record<string, string>, input: unknown) =>
    new Promise<{ status: number; cookie: string; body: unknown }>((resolve, reject) => {
      const req = httpRequest(origin + path, { method: 'POST', headers }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode!,
            cookie: res.headers['set-cookie']?.[0] || '',
            body: JSON.parse(body),
          }),
        );
      });
      req.on('error', reject);
      req.end(JSON.stringify(input));
    });
  const publicLogin = await publicRequest('/api/login', publicHeaders, {
    token: new URLSearchParams(new URL(url).hash.slice(1)).get('token'),
  });
  expect(publicLogin.status).toBe(200);
  expect(publicLogin.cookie).toContain('; Secure');
  const remotePicker = await publicRequest(
    '/api/request',
    {
      ...publicHeaders,
      Cookie: publicLogin.cookie.split(';')[0],
    },
    { method: 'webPickDirectory' },
  );
  expect(remotePicker.body).toEqual({ result: { supported: false } });
  const spoofed = await publicRequest(
    '/api/login',
    {
      ...publicHeaders,
      Origin: 'https://evil.invalid',
    },
    {},
  );
  expect(spoofed.status).toBe(403);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [resolve('tests/fixtures/web-browser.cjs')], env });
  const page = await app.firstWindow();
  await page.goto(localhostURL);
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.locator('.settings-page');
  await expect(settings).toBeVisible();
  const geometry = await settings.evaluate((element) => {
    const body = element.querySelector('.settings-body')!;
    const back = element.querySelector('.settings-nav > button')!;
    return {
      backTop: back.getBoundingClientRect().top,
      bodyRight: body.getBoundingClientRect().right,
      viewport: innerWidth,
      outerOverflow: element.scrollHeight > element.clientHeight,
    };
  });
  expect(geometry.backTop).toBeLessThan(32);
  expect(geometry.bodyRight).toBe(geometry.viewport);
  expect(geometry.outerOverflow).toBe(false);
  await page.screenshot({ path: 'test-results/web-settings.png' });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.goto(url);
  await expect(page.locator('.app-shell')).toBeVisible();
  const loginCookie = (await page.context().cookies()).find(
    (item) => item.name === 'moose_session',
  )!.value;
  await page.goto('about:blank');
  await page.goto(url); // A fresh page from the native browser link reuses this browser's login.
  await expect(page.locator('.app-shell')).toBeVisible();
  expect(
    (await page.context().cookies()).find((item) => item.name === 'moose_session')!.value,
  ).toBe(loginCookie);

  expect(page.url()).not.toContain('token=');
  expect(await page.evaluate(() => window.moose.host)).toBe('web');
  const sidebar = page.locator('.sidebar');
  await expect(sidebar.locator('.sidebar-drag')).toHaveCount(0);
  const toggle = page.locator('.global-sidebar-toggle button');
  const expandedToggle = await toggle.boundingBox();
  const toolbar = await page.locator('.workspace-header').boundingBox();
  expect(expandedToggle!.y + expandedToggle!.height / 2).toBe(toolbar!.y + toolbar!.height / 2);
  const brand = await sidebar.locator('.brand-mark').boundingBox();
  const search = await sidebar
    .getByRole('button', { name: 'Search sessions', exact: true })
    .boundingBox();
  expect(brand!.y + brand!.height / 2).toBe(toolbar!.y + toolbar!.height / 2);
  const add = await sidebar.locator('.project-add-button').boundingBox();
  expect(search!.y + search!.height / 2).toBe(add!.y + add!.height / 2);
  await toggle.click();
  await expect(sidebar).toHaveAttribute('aria-label', 'Projects');
  await expect
    .poll(async () => {
      const box = await sidebar.boundingBox();
      return Math.round(box!.x + box!.width);
    })
    .toBe(0);
  const collapsedToggle = await toggle.boundingBox();
  expect(collapsedToggle!.y + collapsedToggle!.height / 2).toBe(
    expandedToggle!.y + expandedToggle!.height / 2,
  );
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(page.locator('.sidebar-frame')).toHaveAttribute('inert', '');
  await page.screenshot({ path: 'test-results/web-sidebar-collapsed.png' });
  await page.locator('.global-sidebar-toggle button').click();
  await expect(toggle).toBeVisible();
  await expect
    .poll(async () => Math.round((await page.locator('.sidebar-frame').boundingBox())!.width))
    .toBe(264);
  await page.mouse.move(600, 300);
  await page.screenshot({ path: 'test-results/web-sidebar.png' });
  // A cancelled OS chooser must not create a project or open the fallback picker.
  let pickerRequests = 0;
  await page.route('**/api/request', async (route) => {
    if (route.request().postDataJSON()?.method === 'webPickDirectory') {
      pickerRequests++;
      await route.fulfill({ json: { result: { supported: true, path: null } } });
    } else await route.continue();
  });
  expect(
    await page.evaluate(() =>
      Promise.all([window.moose.request('addProject', {}), window.moose.request('addProject', {})]),
    ),
  ).toEqual([null, null]);
  expect(pickerRequests).toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.unroute('**/api/request');
  await page.route('**/api/request', async (route) => {
    if (route.request().postDataJSON()?.method === 'webPickDirectory')
      await route.fulfill({ status: 400, json: { error: 'Chooser unavailable' } });
    else await route.continue();
  });
  expect(
    await page.evaluate(async () => {
      try {
        await window.moose.request('addProject', {});
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    }),
  ).toBe('Chooser unavailable');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.unroute('**/api/request');
  // No preload/IPC bridge exists in this window.
  const projectPromise = page.evaluate(() => window.moose.request('addProject', {}));
  await expect(page.getByRole('button', { name: 'Select folder', exact: true })).toBeEnabled();
  await page.locator('#web-project').fill(dir);
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await page.getByRole('button', { name: 'repo', exact: true }).click();
  await expect(page.locator('#web-project')).toHaveValue(root);
  await expect(page.getByRole('button', { name: 'Select folder', exact: true })).toBeEnabled();
  await page.screenshot({ path: 'test-results/web-directory.png' });
  await page.getByRole('button', { name: 'Parent directory', exact: true }).click();
  await expect(page.locator('#web-project')).toHaveValue(dir);
  await page.getByRole('button', { name: 'repo', exact: true }).click();
  await page.getByRole('button', { name: 'Select folder', exact: true }).click();
  const project = await projectPromise;
  await expect(sidebar.locator('.project-heading')).toBeVisible();
  const columns = await sidebar.evaluate((element) => {
    const newButton = element.querySelector('.sidebar-actions button')!;
    const projectButton = element.querySelector('.project-heading')!;
    const textX = (node: Element) => {
      const text = Array.from(node.childNodes).find(
        (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim(),
      )!;
      const range = document.createRange();
      range.selectNodeContents(text);
      return range.getBoundingClientRect().x;
    };
    return {
      newIcon: newButton.querySelector('svg')!.getBoundingClientRect().x,
      projectIcon: projectButton.querySelector('svg')!.getBoundingClientRect().x,
      newText: textX(newButton),
      projectText: projectButton.querySelector('span')!.getBoundingClientRect().x,
      brandText: element.querySelector('.brand-row > span')!.getBoundingClientRect().x,
    };
  });
  expect(columns.newIcon).toBe(columns.projectIcon);
  expect(columns.newText).toBe(columns.projectText);
  expect(columns.brandText).toBe(columns.projectText);
  await page.screenshot({ path: 'test-results/web-sidebar-alignment.png' });
  const session = await page.evaluate(async (projectId) => {
    const providers = await window.moose.request('providers', { refresh: true });
    if (!providers.find((p) => p.provider === 'opencode')?.connected)
      throw new Error('OpenCode did not connect');
    const session = await window.moose.request('createSession', {
      projectId,
      provider: 'opencode',
    });
    await window.moose.request('send', { sessionId: session.id, text: 'hello' });
    return session;
  }, project!.id);
  await expect
    .poll(async () =>
      (
        await page.evaluate((id) => window.moose.request('messages', { sessionId: id }), session.id)
      ).messages.some((m) => m.kind === 'approval' && m.state === 'pending'),
    )
    .toBe(true);
  await page.reload();
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.getByRole('button', { name: /^hello/ }).click();
  desktop = await electron.launch({
    args: ['.'],
    env: {
      ...env,
      MOOSE_DATA_DIR: join(dir, 'desktop'),
      MOOSE_SHARED_RUNTIME_FILE: join(dir, 'connection.json'),
    },
  });
  let desktopPage = await desktop.firstWindow();
  await expect(desktopPage.locator('.app-shell')).toBeVisible();
  await desktopPage.getByRole('button', { name: /^hello/ }).click();
  await expect(desktopPage.getByRole('button', { name: 'Allow once', exact: true })).toBeVisible();
  await desktop.close();
  desktop = undefined;
  // Exiting the desktop must leave the same live approval available in the browser.
  await expect(page.getByRole('button', { name: 'Allow once', exact: true })).toBeVisible();
  desktop = await electron.launch({
    args: ['.'],
    env: {
      ...env,
      MOOSE_DATA_DIR: join(dir, 'desktop'),
      MOOSE_SHARED_RUNTIME_FILE: join(dir, 'connection.json'),
    },
  });
  desktopPage = await desktop.firstWindow();
  await expect(desktopPage.locator('.app-shell')).toBeVisible();
  await desktopPage.getByRole('button', { name: /^hello/ }).click();
  await desktopPage.getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Allow once', exact: true })).toHaveCount(0);
  await expect
    .poll(async () =>
      (
        await page.evaluate((id) => window.moose.request('messages', { sessionId: id }), session.id)
      ).messages.some((m) => m.text.includes('OpenCode fixture completed')),
    )
    .toBe(true);
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add attachments', exact: true }).click();
  await (
    await chooserPromise
  ).setFiles({
    name: 'web-note.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('browser upload'),
  });
  await expect(page.getByText('web-note.txt', { exact: true })).toBeVisible();
  const terminal = await page.evaluate(
    (projectId) =>
      window.moose.request('terminalStart', {
        projectId,
        requestId: crypto.randomUUID(),
        cols: 90,
        rows: 25,
      }),
    project!.id,
  );
  const desktopTerminals = await desktopPage.evaluate(
    (projectId) => window.moose.request('terminalList', { projectId }),
    project!.id,
  );
  expect(desktopTerminals[0].id).toBe(terminal.id);
  await desktopPage.evaluate(
    (id) => window.moose.request('terminalControl', { id, action: 'acquire' }),
    terminal.id,
  );
  const deniedInput = await page.evaluate(async (id) => {
    const errors: string[] = [];
    for (const operation of [
      () => window.moose.request('terminalInput', { id, text: 'must not execute' }),
      () => window.moose.request('terminalResize', { id, cols: 10, rows: 2 }),
    ]) {
      try {
        await operation();
      } catch (error) {
        errors.push(String(error));
      }
    }
    return errors;
  }, terminal.id);
  expect(deniedInput).toHaveLength(2);
  expect(deniedInput.every((error) => error.includes('another window'))).toBe(true);
  await page.getByRole('button', { name: 'Background commands & schedules', exact: true }).click();
  await expect(page.getByText('Viewing only', { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await page.locator('.xterm-rows').innerText()).trim().length)
    .toBeGreaterThan(0);
  const hintBox = await page.getByText('Viewing only', { exact: true }).boundingBox();
  const screenBox = await page.locator('.terminal-screen').boundingBox();
  expect(hintBox!.y + hintBox!.height).toBeLessThanOrEqual(screenBox!.y);
  await page.screenshot({ path: 'test-results/terminal-viewer.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Take control', exact: true }).click();
  await expect(page.getByText('Viewing only', { exact: true })).toHaveCount(0);
  const displaced = await desktopPage.evaluate(async (id) => {
    try {
      await window.moose.request('terminalInput', { id, text: 'must not execute' });
      return '';
    } catch (error) {
      return String(error);
    }
  }, terminal.id);
  expect(displaced).toContain('another window');
  await page.keyboard.press('Control+Backquote');
  await expect(page.locator('.xterm-screen')).toHaveCount(0);
  await expect
    .poll(() =>
      desktopPage
        .evaluate(
          (id) => window.moose.request('terminalControl', { id, action: 'acquire' }),
          terminal.id,
        )
        .then((control) => control.owned),
    )
    .toBe(true);
  await desktopPage.evaluate(async (id) => {
    const control = await window.moose.request('terminalControl', { id, action: 'acquire' });
    await window.moose.request('terminalControl', { id, action: 'release', lease: control.lease! });
  }, terminal.id);

  await desktop.close();
  desktop = undefined;
  await page.goto('about:blank');
  await page.goto(origin);
  await expect(page.locator('.app-shell')).toBeVisible();
  const terminals = await page.evaluate(
    (projectId) => window.moose.request('terminalList', { projectId }),
    project!.id,
  );
  expect(terminals[0].id).toBe(terminal.id);
  await page.evaluate(
    (id) => window.moose.request('terminalInput', { id, text: "printf 'WEB_RECONNECTED\\n'\r" }),
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
    .toContain('WEB_RECONNECTED\r\n');
  await page.getByRole('button', { name: 'Background commands & schedules', exact: true }).click();
  await expect(page.locator('.xterm-screen')).toBeVisible();
  await page.keyboard.press('Control+Backquote');
  await expect(page.locator('.xterm-screen')).toHaveCount(0);
  await page.keyboard.press('Control+Backquote');
  await expect(page.locator('.xterm-screen')).toBeVisible();
  await page.evaluate(
    (id) =>
      window.moose.request('terminalInput', {
        id,
        text: "sleep 1; printf '\\127\\105\\102\\137\\107\\101\\120\\n'\r",
      }),
    terminal.id,
  );
  await page.context().setOffline(true);
  await page.waitForTimeout(1500); // Output arrives while the browser cannot receive the event stream.
  await page.context().setOffline(false);
  await expect(page.locator('.xterm-rows')).toContainText('WEB_GAP', { timeout: 15000 });
  expect((await page.locator('.xterm-rows').innerText()).match(/WEB_GAP/g)).toHaveLength(1);
  let idleReads = 0;
  const countReads = (request: import('@playwright/test').Request) => {
    if (request.method() === 'POST' && request.postDataJSON()?.method === 'terminalRead')
      idleReads++;
  };
  page.on('request', countReads);
  await page.waitForTimeout(500); // The removed 100 ms poll would issue several reads here.
  page.off('request', countReads);
  expect(idleReads).toBe(0);
  await page.screenshot({ path: 'test-results/web-workspace.png' });
});

test('web appearance, browser shortcuts, narrow layout and expired login recover without losing drafts', async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'moose-web-adaptation-')));
  const root = join(dir, 'repo');
  await mkdir(root);
  const store = new Store(join(dir, 'moose.sqlite'));
  store.setSettings({
    language: 'en',
    theme: 'system',
    codexEnabled: true,
    codexPath: resolve('tests/fixtures/extensions.mjs'),
    grokEnabled: false,
    piEnabled: false,
    opencodeEnabled: false,
  });
  store.close();
  child = spawn(electronPath as unknown as string, ['dist-electron/web-server/web-server.js'], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      MOOSE_WEB_DATA_DIR: dir,
      MOOSE_DATA_DIR: dir,
      MOOSE_WEB_PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout!.on('data', (data) => (output += data));
  child.stderr!.on('data', (data) => (output += data));
  await expect.poll(() => output).toContain('Moose Web (localhost):');
  const url = output.match(/Moose Web \(localhost\): (\S+)/)![1];
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [resolve('tests/fixtures/web-browser.cjs')], env });
  const page = await app.firstWindow();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(url);
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.locator('html')).toHaveClass(/reduce-motion/);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  const project = await page.evaluate(async (path) => {
    const response = await fetch('/api/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'webAddProject', params: { path } }),
    });
    return (await response.json()).result;
  }, root);
  await expect(page.locator('#composer')).toBeVisible();
  await page.locator('#composer').fill('Keep this unsent browser draft');
  await page.locator('.workspace-header').click();
  await page.keyboard.press('Alt+Shift+KeyL');
  await expect(page.locator('#composer')).toBeFocused();
  // Settings show web bindings, not Cmd+L (the browser location bar).
  await page.keyboard.press('Alt+Shift+Comma');
  await expect(page.locator('.settings-page')).toBeVisible();
  await expect(page.locator('.shortcut-section')).toContainText('Alt ⇧ L');
  await expect(page.locator('.shortcut-section')).not.toContainText('⌘ L');
  await page
    .locator('.settings-navigation')
    .getByRole('button', { name: 'Configuration & extensions', exact: true })
    .click();
  await page.getByRole('button', { name: 'Authenticate', exact: true }).click();
  const authLink = page
    .getByRole('status')
    .getByRole('link', { name: 'Authenticate', exact: true });
  await expect(authLink).toHaveAttribute('href', /^https:\/\/example.invalid\/oauth/);
  await expect(authLink).toHaveAttribute('target', '_blank');
  await page.getByRole('status').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('cancelled');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  // Expiration must prompt in place, not unmount the editor or retry writes.
  await page.context().clearCookies();
  await page.evaluate(() => window.moose.request('snapshot', {}).catch(() => {}));
  const reconnect = page.getByRole('dialog', { name: 'Reconnect to workspace' });
  await expect(reconnect).toBeVisible();
  await reconnect
    .getByLabel('Access token')
    .fill(new URLSearchParams(new URL(url).hash.slice(1)).get('token')!);
  await reconnect.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(reconnect).not.toBeVisible();
  await expect(page.locator('#composer')).toHaveValue('Keep this unsent browser draft');
  await page.evaluate(() => window.moose.request('settings', { theme: 'dark' }));
  await expect(page.locator('html')).toHaveClass(/dark/); // Re-subscribed to server events.
  await page.evaluate(() => window.moose.request('settings', { theme: 'light' }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-collapsed/);
  const width = await page
    .locator('.workspace')
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(350);
  await page.locator('.global-sidebar-toggle button').click();
  await expect(page.locator('.web-sidebar-backdrop')).toBeVisible();
  await page.locator('.web-sidebar-backdrop').click({ position: { x: 370, y: 600 } });
  await expect(page.locator('.sidebar-frame')).toHaveAttribute('inert', '');
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  const review = page.locator('.review-panel');
  await expect(review).toBeVisible();
  expect((await review.boundingBox())!.width).toBeLessThanOrEqual(390);
  expect((await review.boundingBox())!.width).toBeGreaterThan(350);
  await page.screenshot({ path: 'test-results/web-narrow-review.png' });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.keyboard.press('Alt+Shift+Comma');
  await expect(page.locator('.settings-page')).toBeVisible();
  expect(
    await page.locator('.settings-page').evaluate((element) => element.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/web-narrow-settings.png' });
  expect(project.id).toBeTruthy();
});
