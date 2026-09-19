import { isAbsolute, resolve } from 'node:path';
import { git, gitStatus, inside } from './git';
import { branchAt, conflicts, gitOperationPending, indexFingerprint } from './worktree-git';
import type { CommitPreview } from '../shared/git-actions';

export async function ordinaryGit(cwd: string) {
  if ((await gitOperationPending(cwd)) || (await conflicts(cwd)).length)
    throw new Error('Finish or abort the pending Git operation before staging or committing here');
}
export async function headAt(cwd: string): Promise<string | null> {
  try {
    return (await git(cwd, ['rev-parse', '--verify', 'HEAD'])).trim();
  } catch (error) {
    if ((error as { code?: unknown }).code === 128) return null;
    throw error;
  }
}
export async function stageFile(cwd: string, path: string, staged: boolean) {
  await ordinaryGit(cwd);
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  if (isAbsolute(path) || !inside(root, resolve(root, path)) || path.split('/').includes('.git'))
    throw new Error('File is outside the repository');
  const status = await gitStatus(cwd);
  const file = status.files.find(
    (f) => f.path === path && (staged ? f.area !== 'staged' : f.area === 'staged'),
  );
  if (!file) throw new Error('File state changed. Refresh before staging.');
  const paths = file.oldPath && file.status === 'R' ? [file.path, file.oldPath] : [file.path];
  if (staged) await git(root, ['add', '--', ...paths]);
  else if (await headAt(cwd)) await git(root, ['reset', '-q', 'HEAD', '--', ...paths]);
  else await git(root, ['rm', '--cached', '--force', '-q', '--', ...paths]);
}
export async function commitPreview(cwd: string): Promise<CommitPreview> {
  await ordinaryGit(cwd);
  const [head, branch, fingerprint] = await Promise.all([
    headAt(cwd),
    branchAt(cwd),
    indexFingerprint(cwd),
  ]);
  const [names, diff] = await Promise.all([
    git(cwd, ['diff', '--no-relative', '--cached', '--name-only', '-z']),
    git(cwd, ['diff', '--no-relative', '--cached', '--no-ext-diff', '--no-textconv', '--no-color']),
  ]);
  if (head !== (await headAt(cwd)) || fingerprint !== (await indexFingerprint(cwd)))
    throw new Error('The index changed while preparing the preview. Refresh.');
  return {
    head,
    branch,
    fingerprint,
    files: names.split('\0').filter(Boolean),
    diff: diff.slice(0, 256_000),
    truncated: diff.length > 256_000,
  };
}
export async function commitReviewed(
  cwd: string,
  expected: Pick<CommitPreview, 'head' | 'branch' | 'fingerprint'>,
  message: string,
) {
  const current = await commitPreview(cwd);
  if (!current.files.length) throw new Error('Stage changes before committing');
  if (
    current.head !== expected.head ||
    current.branch !== expected.branch ||
    current.fingerprint !== expected.fingerprint
  )
    throw new Error('HEAD or staged changes changed. Review a fresh preview before committing.');
  const tree = (await git(cwd, ['write-tree'])).trim();
  if ((await indexFingerprint(cwd)) !== expected.fingerprint)
    throw new Error('The index changed before commit. Refresh.');
  await git(cwd, ['commit', '-m', message]);
  const head = (await headAt(cwd))!;
  if ((await git(cwd, ['rev-parse', `${head}^{tree}`])).trim() !== tree)
    throw new Error(
      `Commit ${head} was created, but a Git hook or external writer changed its content. Inspect it before another commit.`,
    );
  return head;
}
