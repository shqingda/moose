import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  writeFile,
  readFile,
  copyFile,
  chmod,
} from 'node:fs/promises';
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
  dir = await realpath(await mkdtemp(join(tmpdir(), 'moose-git-review-e2e-')));
  const root = join(dir, 'repo');
  await mkdir(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'commit', '--allow-empty', '-qm', 'base');
  const bin = join(dir, 'bin');
  await mkdir(bin);
  await copyFile(resolve('tests/fixtures/github.mjs'), join(bin, 'gh'));
  await chmod(join(bin, 'gh'), 0o755);
  const store = new Store(join(dir, 'moose.sqlite'));
  store.setSettings({
    language: 'en',
    codexPath: resolve('tests/fixtures/agent.mjs'),
    grokEnabled: false,
    piEnabled: false,
  });
  const project = store.addProject(root),
    session = store.createSession(project.id, 'codex');
  store.updateSession(session.id, { title: 'Git workflow', nativeId: 'original-execution' });
  store.close();
  const env: Record<string, string> = Object.fromEntries(
    Object.entries({
      ...process.env,
      MOOSE_DATA_DIR: dir,
      MOOSE_PR_FIXTURE: join(dir, 'pr.json'),
      PATH: `${bin}:${process.env.PATH}`,
    }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: ['.'], env });
  const page = await app.firstWindow();
  await page.waitForSelector('.app-shell');
  await page.getByText('Git workflow', { exact: true }).first().click();
  return { page, root, session };
}
test('stages exact files, retains a failed commit message, and keeps native review separate', async () => {
  const { page, root, session } = await launch();
  await writeFile(join(root, 'first.txt'), 'review this\n');
  await writeFile(join(root, 'leave.txt'), 'leave unstaged\n');
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  const panel = page.locator('.review-panel');
  await panel
    .locator('.review-file')
    .filter({ hasText: 'first.txt' })
    .getByRole('button', { name: 'Stage file', exact: true })
    .click();
  await expect(panel.getByRole('button', { name: 'Unstage file', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Preview commit', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('+review this');
  await expect(dialog).not.toContainText('leave unstaged');
  await dialog.getByRole('textbox', { name: 'Commit message' }).fill('Keep this message');
  await writeFile(join(root, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  await dialog.getByRole('button', { name: 'Commit reviewed changes' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Command failed');
  await expect(dialog.getByRole('button', { name: 'Commit reviewed changes' })).toBeDisabled();
  await expect(dialog.getByRole('textbox', { name: 'Commit message' })).toHaveValue(
    'Keep this message',
  );
  await rm(join(root, '.git/hooks/pre-commit'));
  await dialog.getByRole('button', { name: 'Refresh', exact: true }).click();
  await dialog.getByRole('button', { name: 'Commit reviewed changes' }).click();
  await expect(dialog.getByRole('status')).toContainText('Committed');
  expect(git(root, 'show', 'HEAD:first.txt')).toBe('review this');
  expect(git(root, 'status', '--porcelain')).toContain('leave.txt');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await panel.getByRole('button', { name: 'Native code review' }).click();
  await dialog.getByRole('button', { name: 'Start native review' }).click();
  await expect(dialog).toContainText('Review completed');
  await expect(dialog).toContainText('src/example.ts:12');
  const snapshot = await page.evaluate(() => window.moose.request('snapshot', {}));
  expect(snapshot.sessions.find((s) => s.id === session.id)?.nativeId).toBe('original-execution');
  await expect(dialog.getByRole('heading', { name: 'Native code review' })).toBeVisible();
  await page.screenshot({ path: 'test-results/git-native-review.png' });
});
test('previews explicit PR targets and creates a draft through the GitHub fixture', async () => {
  const { page, root } = await launch();
  const remote = join(dir, 'remote.git');
  git(root, 'init', '--bare', '-q', remote);
  const url = 'https://github.com/example/moose-fixture.git';
  git(root, 'config', `url.${remote}.insteadOf`, url);
  git(root, 'remote', 'add', 'origin', url);
  git(root, 'push', '-q', 'origin', 'main');
  git(root, 'checkout', '-qb', 'feature');
  await writeFile(join(root, 'feature.txt'), 'change\n');
  git(root, 'add', 'feature.txt');
  git(root, 'commit', '-qm', 'feature');
  git(root, 'push', '-q', 'origin', 'feature');
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page
    .locator('.review-panel')
    .getByRole('button', { name: 'Pull requests', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Preview / refresh PR status' }).click();
  await expect(dialog).toContainText('feature → main');
  await expect(dialog).toContainText('+change');
  await dialog.getByRole('textbox', { name: 'PR title' }).fill('Feature review');
  await dialog.getByRole('textbox', { name: 'PR description' }).fill('Exact\nbody');
  await dialog.getByRole('button', { name: 'Create draft PR' }).click();
  await expect(dialog).toContainText('https://github.com/example/moose-fixture/pull/1');
  const calls = (await readFile(join(dir, 'pr.json.log'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const create = calls.find((c) => c.args[1] === 'create');
  expect(create.args).toContain('--draft');
  expect(
    create.args.slice(create.args.indexOf('--head') + 1, create.args.indexOf('--head') + 2),
  ).toEqual(['feature']);
  expect(create.body).toBe('Exact\nbody');
  await dialog.getByRole('button', { name: 'Preview / refresh PR status' }).click();
  await expect(dialog).toContainText('#1 OPEN: Feature review');
  await page.screenshot({ path: 'test-results/pull-request-preview.png' });
});
