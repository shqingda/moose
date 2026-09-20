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
  await page.goto(url);
  await expect(page.locator('.app-shell')).toBeVisible();
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
  await page.screenshot({ path: 'test-results/web-workspace.png' });
});
