import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { git } from './git';

export async function commitAt(cwd: string, ref = 'HEAD') {
  return (await git(cwd, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).trim();
}
export async function branchAt(cwd: string) {
  return (await git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
}
export async function registeredWorktrees(cwd: string) {
  return (await git(cwd, ['worktree', 'list', '--porcelain', '-z']))
    .split('\0\0')
    .filter(Boolean)
    .map((entry) => {
      const fields = entry.split('\0');
      return {
        path: fields.find((field) => field.startsWith('worktree '))?.slice(9) || '',
        branch: fields.find((field) => field.startsWith('branch '))?.slice(7) || '',
      };
    });
}
export async function commonDirectory(cwd: string) {
  return realpath(resolve(cwd, (await git(cwd, ['rev-parse', '--git-common-dir'])).trim()));
}
export async function isAncestor(cwd: string, ancestor: string, descendant: string) {
  try {
    await git(cwd, ['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return false;
    throw error;
  }
}
export async function dirty(cwd: string, ignored = false) {
  return !!(await git(cwd, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    ...(ignored ? ['--ignored=matching'] : []),
  ]));
}
export async function mergeHead(cwd: string) {
  try {
    return (await git(cwd, ['rev-parse', '--verify', 'MERGE_HEAD'])).trim();
  } catch (error) {
    if ((error as { code?: unknown }).code === 128) return null;
    throw error;
  }
}
export async function conflicts(cwd: string) {
  return (await git(cwd, ['diff', '--name-only', '--diff-filter=U', '-z']))
    .split('\0')
    .filter(Boolean);
}
export async function indexFingerprint(cwd: string) {
  // Include index object IDs and modes, not timestamps or a truncated human preview.
  return createHash('sha256')
    .update(await git(cwd, ['ls-files', '--stage', '-z']))
    .digest('hex');
}

export async function gitOperationPending(cwd: string) {
  const dir = (await git(cwd, ['rev-parse', '--absolute-git-dir'])).trim();
  const entries = await Promise.all(
    [
      'MERGE_HEAD',
      'CHERRY_PICK_HEAD',
      'REVERT_HEAD',
      'rebase-merge',
      'rebase-apply',
      'sequencer',
      'BISECT_LOG',
    ].map((name) =>
      lstat(resolve(dir, name)).catch((e) => {
        if (e.code === 'ENOENT') return null;
        throw e;
      }),
    ),
  );
  return entries.some(Boolean);
}
