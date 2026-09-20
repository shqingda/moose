import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../electron/db/store';
import { SharedRuntime } from '../../electron/shared-runtime';

test('desktop starts one shared service in its existing data directory and can stop it from the menu', async () => {
  const data = await mkdtemp(join(tmpdir(), 'moose-desktop-runtime-'));
  const projectPath = join(data, 'repo');
  await mkdir(projectPath);
  const store = new Store(join(data, 'moose.sqlite'));
  store.setSettings({
    language: 'en',
    codexEnabled: false,
    grokEnabled: false,
    piEnabled: false,
    opencodeEnabled: false,
  });
  const project = store.addProject(projectPath);
  const session = store.createSession(project.id, 'codex');
  store.updateSession(session.id, { title: 'Existing desktop history' });
  store.close();
  let app: ElectronApplication | undefined;
  const connection = join(data, 'connection.json');
  const client = new SharedRuntime(connection, () => {});
  const launch = async () => {
    const env = Object.fromEntries(
      Object.entries({ ...process.env, MOOSE_DATA_DIR: data, MOOSE_RUNTIME_MODE: 'shared' }).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ args: ['.'], env });
    const page = await app.firstWindow();
    await expect(page.getByText('Existing desktop history', { exact: true }).first()).toBeVisible();
    return page;
  };
  try {
    const page = await launch();
    const firstPid = await readFile(join(data, 'server.lock'), 'utf8');
    const terminal = await page.evaluate(
      (projectId) =>
        window.moose.request('terminalStart', {
          projectId,
          requestId: crypto.randomUUID(),
          cols: 80,
          rows: 24,
        }),
      project.id,
    );
    await app!.close();
    app = undefined;
    const snapshot = (await client.request('snapshot', {})) as { projects: { id: string }[] };
    expect(snapshot.projects[0].id).toBe(project.id);
    const browserURL = new URL(await client.browserURL());
    expect(browserURL.hostname).toBe('127.0.0.1');
    expect(browserURL.hash).toMatch(/^#token=/);
    const next = await launch();
    expect(await readFile(join(data, 'server.lock'), 'utf8')).toBe(firstPid);
    const terminals = await next.evaluate(
      (projectId) => window.moose.request('terminalList', { projectId }),
      project.id,
    );
    expect(terminals.map((item) => item.id)).toContain(terminal.id);
    const menu = await app!.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!
        .items[0].submenu!.items.filter((item) => item.visible)
        .map((item) => item.label),
    );
    expect(menu).toContain('Open in Browser');
    expect(menu).toContain('Quit Moose (Keep Background Running)');
    await app!.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()!.items[0].submenu!.items.find(
        (item) => item.label === 'Quit and Stop Background Service',
      )!;
      item.click();
    });
    await expect
      .poll(async () => {
        try {
          await stat(join(data, 'server.lock'));
          return true;
        } catch {
          return false;
        }
      })
      .toBe(false);
    app = undefined;
  } finally {
    await app?.close().catch(() => {});
    await client.stop().catch(() => {});
    await client.close();
    await rm(data, { recursive: true, force: true });
  }
});
