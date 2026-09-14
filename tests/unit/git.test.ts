// 单元测试：工作区状态、diff 与路径边界。
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitStatus, gitDiff, parseStatus } from '../../electron/git';
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
it('parses NUL-delimited filenames including spaces, Unicode, newline and renames', () => {
  expect(parseStatus('RM 新 名.ts\0old.ts\0?? strange\nname\0')).toEqual([
    { path: '新 名.ts', oldPath: 'old.ts', status: 'R', area: 'staged' },
    { path: '新 名.ts', oldPath: 'old.ts', status: 'M', area: 'unstaged' },
    { path: 'strange\nname', status: '?', area: 'untracked' },
  ]);
});
it('reviews existing, staged and untracked edits, bounds previews and rejects escapes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moose-git-'));
  dirs.push(dir);
  const git = (...args: string[]) =>
    execFileSync('/usr/bin/git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  await writeFile(join(dir, '文件 name.txt'), 'original\n');
  git('add', '.');
  git(
    '-c',
    'user.name=Moose Test',
    '-c',
    'user.email=test@moose.invalid',
    'commit',
    '-qm',
    'fixture',
  );
  await writeFile(join(dir, '文件 name.txt'), 'staged\n');
  git('add', '.');
  await writeFile(join(dir, '文件 name.txt'), 'working\n');
  await writeFile(join(dir, 'binary'), Buffer.from([0, 1, 2]));
  await writeFile(join(dir, 'large.txt'), 'x'.repeat(300000));
  await symlink('/etc/passwd', join(dir, 'link'));
  const status = await gitStatus(dir);
  expect(status.files.filter((f) => f.path === '文件 name.txt')).toHaveLength(2);
  expect((await gitDiff(dir, '文件 name.txt', 'staged')).text).toContain('+staged');
  expect((await gitDiff(dir, '文件 name.txt', 'unstaged')).text).toContain('+working');
  expect((await gitDiff(dir, 'binary', 'untracked')).binary).toBe(true);
  expect((await gitDiff(dir, 'large.txt', 'untracked')).truncated).toBe(true);
  expect((await gitDiff(dir, 'link', 'untracked')).text).toBe('Symbolic link → /etc/passwd');
  await expect(gitDiff(dir, '../etc/passwd', 'untracked')).rejects.toThrow();
  await expect(gitDiff(dir, '.git/config', 'untracked')).rejects.toThrow();
});
it('gracefully handles a non-Git project', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moose-no-git-'));
  dirs.push(dir);
  expect((await gitStatus(dir)).isRepo).toBe(false);
});
