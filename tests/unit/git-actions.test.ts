import { afterEach, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageFile, commitPreview, commitReviewed } from '../../electron/git-actions';
import { createPullRequest, pullRequestPreview, type GitHub } from '../../electron/pull-requests';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
function git(cwd: string, ...args: string[]) {
  return execFileSync('/usr/bin/git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
function fixture(initial = true) {
  const cwd = mkdtempSync(join(tmpdir(), 'moose-git-actions-'));
  dirs.push(cwd);
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'config', 'user.name', 'Test');
  git(cwd, 'config', 'user.email', 'test@example.invalid');
  git(cwd, 'config', 'commit.gpgsign', 'false');
  if (initial) git(cwd, 'commit', '--allow-empty', '-qm', 'base');
  return cwd;
}
it('stages literal files, commits only the reviewed index, and preserves unstaged edits', async () => {
  const cwd = fixture();
  writeFileSync(join(cwd, 'one [a].txt'), 'reviewed\n');
  writeFileSync(join(cwd, 'other.txt'), 'leave alone\n');
  await stageFile(cwd, 'one [a].txt', true);
  const preview = await commitPreview(cwd);
  expect(preview.diff).toContain('+reviewed');
  expect(preview.diff).not.toContain('leave alone');
  writeFileSync(join(cwd, 'one [a].txt'), 'later edit\n');
  await commitReviewed(cwd, preview, 'reviewed commit');
  expect(git(cwd, 'show', 'HEAD:one [a].txt')).toBe('reviewed');
  expect(readFileSync(join(cwd, 'one [a].txt'), 'utf8')).toBe('later edit\n');
  expect(git(cwd, 'status', '--porcelain')).toContain('other.txt');
  await expect(stageFile(cwd, '../escape', true)).rejects.toThrow('outside');
});
it('rejects stale index and HEAD previews and supports unstaging an unborn repository', async () => {
  const cwd = fixture(false);
  writeFileSync(join(cwd, 'new.txt'), 'new\n');
  await stageFile(cwd, 'new.txt', true);
  writeFileSync(join(cwd, 'new.txt'), 'newer unstaged edit\n');
  await stageFile(cwd, 'new.txt', false);
  expect(readFileSync(join(cwd, 'new.txt'), 'utf8')).toBe('newer unstaged edit\n');
  expect(git(cwd, 'ls-files')).toBe('');
  await stageFile(cwd, 'new.txt', true);
  const old = await commitPreview(cwd);
  writeFileSync(join(cwd, 'new.txt'), 'changed\n');
  await stageFile(cwd, 'new.txt', true);
  await expect(commitReviewed(cwd, old, 'stale')).rejects.toThrow('fresh preview');
  const current = await commitPreview(cwd);
  git(cwd, 'commit', '--allow-empty', '-qm', 'external');
  await expect(commitReviewed(cwd, current, 'stale')).rejects.toThrow();
});
it('unstages both rename paths and refuses ordinary Git actions during conflicts', async () => {
  const cwd = fixture();
  writeFileSync(join(cwd, 'old.txt'), 'base\n'.repeat(20));
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-qm', 'file');
  git(cwd, 'mv', 'old.txt', 'new.txt');
  writeFileSync(join(cwd, 'new.txt'), 'base\n'.repeat(20) + 'new line\n');
  await stageFile(cwd, 'new.txt', true);
  expect(git(cwd, 'show', ':new.txt')).toContain('new line');
  await stageFile(cwd, 'new.txt', false);
  expect(git(cwd, 'diff', '--cached')).toBe('');
  git(cwd, 'reset', '--hard', 'HEAD');
  git(cwd, 'checkout', '-qb', 'side');
  writeFileSync(join(cwd, 'old.txt'), 'side\n');
  git(cwd, 'commit', '-am', 'side');
  git(cwd, 'checkout', 'main');
  writeFileSync(join(cwd, 'old.txt'), 'main\n');
  git(cwd, 'commit', '-am', 'main');
  try {
    git(cwd, 'merge', 'side');
  } catch {}
  await expect(stageFile(cwd, 'old.txt', true)).rejects.toThrow('pending Git');
  await expect(commitPreview(cwd)).rejects.toThrow('pending Git');
});
it('keeps failed hook input and staged content available for an explicit retry', async () => {
  const cwd = fixture();
  writeFileSync(join(cwd, 'new.txt'), 'new\n');
  await stageFile(cwd, 'new.txt', true);
  const preview = await commitPreview(cwd);
  writeFileSync(join(cwd, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  await expect(commitReviewed(cwd, preview, 'keep my message')).rejects.toThrow();
  expect((await commitPreview(cwd)).fingerprint).toBe(preview.fingerprint);
});
it('pins PR origin, base and head, creates a draft once, and detects remote drift', async () => {
  const cwd = fixture(),
    remote = join(cwd, 'remote.git');
  git(cwd, 'init', '--bare', '-q', remote);
  const url = 'https://github.com/example/moose-test.git';
  git(cwd, 'config', `url.${remote}.insteadOf`, url);
  git(cwd, 'remote', 'add', 'origin', url);
  git(cwd, 'push', '-q', 'origin', 'main');
  await expect(pullRequestPreview(cwd, 'main', async () => '[]')).rejects.toThrow('different');
  git(cwd, 'checkout', '-qb', 'feature');
  writeFileSync(join(cwd, 'file.txt'), 'pr\n');
  git(cwd, 'add', 'file.txt');
  git(cwd, 'commit', '-qm', 'pr');
  await expect(pullRequestPreview(cwd, 'main', async () => '[]')).rejects.toThrow('Publish');
  git(cwd, 'push', '-q', 'origin', 'feature');
  const calls: string[][] = [];
  let exists = false;
  const gh: GitHub = async (_cwd, args) => {
    calls.push(args);
    if (args[1] === 'list')
      return JSON.stringify(
        exists
          ? [
              {
                url: 'https://github.com/example/moose-test/pull/1',
                number: 1,
                title: 'title',
                state: 'OPEN',
                baseRefName: 'main',
                headRefName: 'feature',
              },
            ]
          : [],
      );
    expect(args).toContain('--draft');
    expect(readFileSync(args[args.indexOf('--body-file') + 1], 'utf8')).toBe('exact\nbody');
    exists = true;
    return 'https://github.com/example/moose-test/pull/1\n';
  };
  const preview = await pullRequestPreview(cwd, 'main', gh);
  expect(preview.diff).toContain('+pr');
  expect(preview.branch).toBe('feature');
  expect(await createPullRequest(cwd, preview, 'title', 'exact\nbody', gh)).toContain('/pull/1');
  await createPullRequest(cwd, preview, 'title', 'exact\nbody', gh);
  expect(calls.filter((args) => args[1] === 'create')).toHaveLength(1);
  git(cwd, 'checkout', 'main');
  git(cwd, 'commit', '--allow-empty', '-qm', 'base moved');
  git(cwd, 'push', '-q', 'origin', 'main');
  git(cwd, 'checkout', 'feature');
  await expect(createPullRequest(cwd, preview, 'title', 'body', gh)).rejects.toThrow(
    'target changed',
  );
});
it('reports the created commit if a hook changes the reviewed tree', async () => {
  const cwd = fixture();
  writeFileSync(join(cwd, 'a.txt'), 'reviewed\n');
  await stageFile(cwd, 'a.txt', true);
  const preview = await commitPreview(cwd);
  writeFileSync(
    join(cwd, '.git/hooks/pre-commit'),
    '#!/bin/sh\nprintf "hook edit\\n" > a.txt\n/usr/bin/git add -- a.txt\n',
    { mode: 0o755 },
  );
  await expect(commitReviewed(cwd, preview, 'hook modified')).rejects.toThrow('was created');
  expect(git(cwd, 'show', 'HEAD:a.txt')).toBe('hook edit');
});

it('uses repository-relative paths when a project opens a nested directory', async () => {
  const cwd = fixture(),
    nested = join(cwd, 'nested');
  mkdirSync(nested);
  writeFileSync(join(nested, 'file.txt'), 'nested change\n');
  writeFileSync(join(cwd, 'root.txt'), 'root change\n');
  await stageFile(nested, 'nested/file.txt', true);
  expect(git(cwd, 'diff', '--cached', '--name-only')).toBe('nested/file.txt');
  await stageFile(nested, 'nested/file.txt', false);
  expect(git(cwd, 'diff', '--cached')).toBe('');
  git(cwd, 'add', 'root.txt', 'nested/file.txt');
  git(cwd, 'config', 'diff.relative', 'true');
  const preview = await commitPreview(nested);
  expect(preview.files).toEqual(['nested/file.txt', 'root.txt']);
  expect(preview.diff).toContain('+root change');
  expect(preview.diff).toContain('+nested change');
});
