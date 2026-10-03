import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtemp, mkdir, realpath, rm, readFile, writeFile, access } from 'node:fs/promises';
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
    opencodeEnabled: false,
    codexPath: resolve('tests/fixtures/agent.mjs'),
    grokPath: resolve('tests/fixtures/agent.mjs'),
    piPath: resolve('tests/fixtures/pi.mjs'),
  });
  const project = store.addProject(root),
    session = store.createSession(project.id, 'codex');
  store.updateSession(session.id, { title: 'Project root' });
  store.close();
  const page = await openDesktop();
  await page.getByText('Project root', { exact: true }).first().click();
  return { page, root, project, session };
}
async function openDesktop() {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries({ ...process.env, MOOSE_DATA_DIR: dir }).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: ['.'], env });
  const page = await app.firstWindow();
  await page.waitForSelector('.app-shell');
  return page;
}
async function create(page: Page, branch: string) {
  await page.getByRole('button', { name: 'Workspace tools', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Worktrees', exact: true }).click();
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
  await page.getByRole('button', { name: 'Workspace tools', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Worktrees', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('+moose-approved');
  await dialog.getByRole('button', { name: 'Prepare merge into project', exact: true }).click();
  await dialog.getByRole('button', { name: 'Commit merge', exact: true }).click();
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

for (const outcome of ['complete', 'abort'] as const)
  test(`recovers merge conflicts after desktop restart and can ${outcome} through the UI`, async () => {
    const launched = await launch();
    let page = launched.page;
    const root = launched.root;
    await writeFile(join(root, 'base.txt'), 'base\n');
    await writeFile(join(root, 'unrelated.txt'), 'unchanged\n');
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'conflict base');
    const session = await create(page, `moose/conflict-${outcome}`);
    const path = await page.evaluate(
      (s) => window.moose.request('workspacePath', { projectId: s.projectId, sessionId: s.id }),
      session,
    );
    await writeFile(join(path, 'base.txt'), 'source\n');
    git(path, 'commit', '-qam', 'source');
    const sourceCommit = git(path, 'rev-parse', 'HEAD');
    await writeFile(join(root, 'base.txt'), 'target\n');
    git(root, 'commit', '-qam', 'target');
    const targetCommit = git(root, 'rev-parse', 'HEAD');
    await page.locator('#composer').fill('keep conflict draft');
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.moose.request('snapshot', {}))).sessions.find(
            (s) => s.id === session.id,
          )?.draft,
      )
      .toBe('keep conflict draft');
    await page.getByRole('button', { name: 'Workspace tools', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Worktrees', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Prepare merge into project', exact: true })
      .click();
    await expect(page.getByRole('dialog').getByText('conflicts', { exact: true })).toBeVisible();
    expect(git(root, 'rev-parse', 'MERGE_HEAD')).toBe(sourceCommit);
    await app.close();
    page = await openDesktop();
    await page.locator('.session-row').filter({ hasText: session.title }).click();
    await expect(page.locator('#composer')).toHaveValue('keep conflict draft');
    await page.getByRole('button', { name: 'Workspace tools', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Worktrees', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('conflicts', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Commit merge', exact: true })).toBeDisabled();
    await expect(
      dialog.getByRole('button', { name: 'Remove worktree', exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole('button', { name: 'Mark resolved and stage', exact: true }),
    ).toHaveCount(1);
    expect(git(root, 'diff', '--name-only', '--diff-filter=U')).toBe('base.txt');
    if (outcome === 'complete') {
      // File editing belongs to the external editor; stage and commit use the real UI.
      await writeFile(join(root, 'base.txt'), 'resolved\n');
      await writeFile(join(root, 'unrelated.txt'), 'unrelated edit\n');
      await dialog.getByRole('button', { name: 'Mark resolved and stage', exact: true }).click();
      await expect(dialog.getByText('pending', { exact: true })).toBeVisible();
      expect(git(root, 'diff', '--cached', '--name-only')).toBe('base.txt');
      await dialog.getByRole('button', { name: 'Commit merge', exact: true }).click();
      await expect(dialog).toContainText(
        'Unstaged changes remain; review them before completing the merge',
      );
      expect(git(root, 'rev-parse', 'HEAD')).toBe(targetCommit);
      await writeFile(join(root, 'unrelated.txt'), 'unchanged\n');
      await dialog.getByRole('button', { name: 'Refresh worktree status', exact: true }).click();
      await dialog.getByRole('button', { name: 'Commit merge', exact: true }).click();
      await expect(dialog).toContainText('All worktree commits are in the project branch.');
      expect(git(root, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ').slice(1)).toEqual([
        targetCommit,
        sourceCommit,
      ]);
      expect(await readFile(join(root, 'base.txt'), 'utf8')).toBe('resolved\n');
    } else {
      await dialog.getByRole('button', { name: 'Abort merge', exact: true }).click();
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: 'Cancel', exact: true })
        .click();
      expect(git(root, 'rev-parse', 'MERGE_HEAD')).toBe(sourceCommit);
      await dialog.getByRole('button', { name: 'Abort merge', exact: true }).click();
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: 'Confirm', exact: true })
        .click();
      await expect(
        dialog.getByRole('button', { name: 'Prepare merge into project', exact: true }),
      ).toBeEnabled();
      expect(git(root, 'rev-parse', 'HEAD')).toBe(targetCommit);
      expect(await readFile(join(root, 'base.txt'), 'utf8')).toBe('target\n');
    }
    expect(git(root, 'status', '--porcelain')).toBe('');
    expect(git(path, 'rev-parse', 'HEAD')).toBe(sourceCommit);
    expect(await readFile(join(path, 'base.txt'), 'utf8')).toBe('source\n');
    await expect(access(join(root, '.git', 'MERGE_HEAD'))).rejects.toThrow();
    const status = await page.evaluate(
      (id) => window.moose.request('worktreeStatus', { id }),
      session.worktreeId!,
    );
    expect(status.worktree.merge?.state).toBe(outcome === 'complete' ? 'complete' : 'aborted');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('#composer')).toHaveValue('keep conflict draft');
  });
