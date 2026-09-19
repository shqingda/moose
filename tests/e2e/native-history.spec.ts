import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../../electron/db/store';
let app: ElectronApplication, dir: string;
test.afterEach(async () => {
  await app?.close().catch(() => {});
  if (dir) await rm(dir, { recursive: true, force: true });
});
async function launch(provider: 'codex' | 'grok' = 'codex') {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'moose-history-e2e-')));
  const store = new Store(join(dir, 'moose.sqlite'));
  store.setSettings({
    language: 'en',
    codexPath: resolve('tests/fixtures/agent.mjs'),
    grokPath: resolve('tests/fixtures/agent.mjs'),
    piPath: resolve('tests/fixtures/pi.mjs'),
  });
  const project = store.addProject(dir),
    session = store.createSession(project.id, provider);
  store.updateSession(session.id, { title: 'Native workspace' });
  store.close();
  const env: Record<string, string> = Object.fromEntries(
    Object.entries({ ...process.env, MOOSE_DATA_DIR: dir, MOOSE_HISTORY_CWD: dir }).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: ['.'], env });
  const page = await app.firstWindow();
  await page.waitForSelector('.app-shell');
  await page.getByText('Native workspace', { exact: true }).first().click();
  return { page, project, session };
}
test('imports paginated native history once, forks with lineage and waits for compaction completion', async () => {
  const { page, project } = await launch();
  await page.getByRole('button', { name: 'Workspace tools', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Native sessions', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Load more history', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Second native conversation' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Imported native conversation' }).click();
  await expect(dialog).toContainText('Native history first page.');
  await dialog.getByRole('button', { name: 'Load more history', exact: true }).click();
  await expect(dialog).toContainText('Native history second page.');
  await dialog.getByRole('button', { name: 'Import or open conversation' }).click();
  await expect(page.locator('.header-title')).toHaveText('Imported native conversation');
  const imported = await page.evaluate(
    async (projectId) =>
      window.moose.request('nativeImport', {
        projectId,
        provider: 'codex',
        nativeId: 'history-root',
      }),
    project.id,
  );
  expect(
    (await page.evaluate(() => window.moose.request('snapshot', {}))).sessions.filter(
      (s) => s.nativeId === 'history-root',
    ),
  ).toHaveLength(1);
  await page.reload();
  await page.waitForSelector('.app-shell');
  await page.getByRole('button', { name: 'Workspace tools', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Native sessions', exact: true }).click();
  await dialog.getByRole('button', { name: 'Native history first page.', exact: true }).click();
  await dialog.getByRole('button', { name: 'Fork from selected turn' }).click();
  await expect(page.locator('.header-title')).toHaveText('Forked native conversation');
  const fork = (await page.evaluate(() => window.moose.request('snapshot', {}))).sessions.find(
    (s) => s.nativeId === 'history-fork',
  )!;
  expect(fork.nativeOrigin).toMatchObject({
    sourceSessionId: imported.id,
    sourceNativeId: 'history-root',
    forkTurnId: 'history-turn',
  });
  await page.getByRole('button', { name: 'Workspace tools', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Native sessions', exact: true }).click();
  await dialog.getByRole('button', { name: 'Compact native context', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Working');
  await expect(dialog.getByRole('status')).toContainText('Native context compaction completed.');
  await page.screenshot({ path: 'test-results/native-session-tools.png' });
});
test('replays Grok native history without claiming unsupported lifecycle controls', async () => {
  const { page } = await launch('grok');
  await page.getByRole('button', { name: 'Workspace tools', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Native sessions', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Grok native history', exact: true }).click();
  await expect(dialog).toContainText('Grok history answer');
  await dialog.getByRole('button', { name: 'Import or open conversation' }).click();
  await expect(page.locator('.header-title')).toHaveText('Grok native history');
  await page.getByRole('button', { name: 'Workspace tools', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Native sessions', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Compact native context', exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Fork from selected turn' })).toBeDisabled();
});
test('opens child history independently while child approvals remain in the parent', async () => {
  const { page, session } = await launch();
  await page.locator('#composer').fill('delegate-fixture');
  await page.locator('#composer').press('Enter');
  await expect(page.locator('.subagent-activity')).toBeVisible();
  await page.locator('.subagent-activity summary').first().click();
  await page.getByRole('button', { name: 'Open subagent', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Child history stays in its own panel.');
  await expect(dialog.getByRole('button', { name: 'Send to subagent' })).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'Message to subagent' }).fill('Inspect only');
  await dialog.getByRole('button', { name: 'Send to subagent' }).click();
  await expect(dialog).toContainText('Child accepted: Inspect only');
  await dialog.getByRole('button', { name: 'Interrupt', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Interrupt', exact: true })).toBeDisabled();
  expect(
    (await page.evaluate(() => window.moose.request('snapshot', {}))).sessions.find(
      (s) => s.id === session.id,
    )?.status,
  ).toBe('waiting');
  await expect(
    page.evaluate(
      (sessionId) => window.moose.request('childRead', { sessionId, nativeId: 'unknown-child' }),
      session.id,
    ),
  ).rejects.toThrow('Unknown child');
  await page.screenshot({ path: 'test-results/native-child-panel.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect(page.locator('.markdown')).toContainText('Delegated work complete.');
});
