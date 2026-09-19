import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtemp, mkdir, realpath, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store } from '../../electron/db/store';
let app: ElectronApplication, dir: string;
test.afterEach(async () => {
  await app?.close().catch(() => {});
  if (dir) await rm(dir, { recursive: true, force: true });
});
function git(cwd: string, ...args: string[]) {
  return execFileSync('/usr/bin/git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
async function launch() {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'moose-worktree-e2e-')));
  const root = join(dir, 'repo');
  await mkdir(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'commit', '--allow-empty', '-qm', 'base');
  const store = new Store(join(dir, 'moose.sqlite'));
  store.setSettings({
    language: 'en',
    codexPath: resolve('tests/fixtures/agent.mjs'),
    grokPath: resolve('tests/fixtures/agent.mjs'),
    piPath: resolve('tests/fixtures/pi.mjs'),
  });
  const project = store.addProject(root),
    session = store.createSession(project.id, 'codex');
  store.updateSession(session.id, { title: 'Project root' });
  store.close();
  const env: Record<string, string> = Object.fromEntries(
    Object.entries({ ...process.env, MOOSE_DATA_DIR: dir }).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: ['.'], env });
  const page = await app.firstWindow();
  await page.waitForSelector('.app-shell');
  await page.getByText('Project root', { exact: true }).first().click();
  return { page, root, project, session };
}
async function create(page: Page, branch: string) {
  await page.getByRole('button', { name: 'Worktrees', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'New branch', exact: true }).fill(branch);
  await dialog.getByRole('button', { name: 'Create isolated conversation' }).click();
  await expect(page.locator('.header-title')).toHaveText(branch);
  return (await page.evaluate(() => window.moose.request('snapshot', {}))).sessions.find(
    (s) => s.title === branch,
  )!;
}
test('isolates agent writes and diff, merges reviewed changes, and safely cleans the managed directory', async () => {
  const { page, root, project } = await launch();
  const session = await create(page, 'moose/isolated');
  const path = await page.evaluate(
    (s) => window.moose.request('workspacePath', { projectId: s.projectId, sessionId: s.id }),
    session,
  );
  expect(path).not.toBe(root);
  await page.locator('#composer').fill('Implement in the isolated directory');
  await page.locator('#composer').press('Enter');
  await page.getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect(page.locator('.markdown')).toContainText('Implemented the change.');
  expect(await readFile(join(path, 'approved.txt'), 'utf8')).toBe('moose-approved\n');
  await expect(access(join(root, 'approved.txt'))).rejects.toThrow();
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.locator('.change-file').click();
  await expect(page.locator('.review-context')).toContainText('moose/isolated');
  await expect(page.locator('.diff-code')).toContainText('+moose-approved');
  await page.locator('.review-panel').getByRole('button', { name: 'Close', exact: true }).click();
  git(path, 'add', 'approved.txt');
  git(path, 'commit', '-qm', 'agent change');
  await page.getByRole('button', { name: 'Worktrees', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('+moose-approved');
  await dialog.getByRole('button', { name: 'Prepare merge into project', exact: true }).click();
  await dialog.getByRole('button', { name: 'Commit reviewed merge', exact: true }).click();
  await expect(dialog).toContainText('All worktree commits are in the project branch.');
  expect(await readFile(join(root, 'approved.txt'), 'utf8')).toBe('moose-approved\n');
  await expect(dialog.getByRole('heading', { name: 'Worktrees', exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'test-results/worktree-merged.png' });
  await dialog.getByRole('button', { name: 'Keep worktree', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Remove worktree', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Allow cleanup', exact: true }).click();
  await dialog.getByRole('button', { name: 'Remove worktree', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Remove worktree', exact: true })).toBeDisabled();
  await expect(access(path)).rejects.toThrow();
  const trees = await page.evaluate(
    (projectId) => window.moose.request('worktreeList', { projectId }),
    project.id,
  );
  expect(trees[0].status).toBe('removed');
});
test('keeps two isolated conversations running in parallel in the same project', async () => {
  const { page } = await launch();
  const first = await create(page, 'moose/parallel-one');
  await page.locator('#composer').fill('hold');
  await page.locator('#composer').press('Enter');
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.moose.request('snapshot', {}))).sessions.find(
          (s) => s.id === first.id,
        )?.status,
    )
    .toBe('running');
  const second = await create(page, 'moose/parallel-two');
  await page.locator('#composer').fill('hold');
  await page.locator('#composer').press('Enter');
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.moose.request('snapshot', {}))).sessions.filter(
          (s) => s.status === 'running',
        ).length,
    )
    .toBe(2);
  await page.screenshot({ path: 'test-results/worktree-parallel.png' });
  await page.evaluate(
    async (ids) => {
      for (const sessionId of ids) await window.moose.request('stop', { sessionId });
    },
    [first.id, second.id],
  );
});
