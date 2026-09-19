import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from './git';
import { branchAt, commitAt } from './worktree-git';
import { ordinaryGit } from './git-actions';
import { agentEnvironment, discover } from './providers/process';
import type { PullRequestPreview, PullRequestTarget } from '../shared/git-actions';
const execute = promisify(execFile);
const pullRequests = z.array(
  z.object({
    url: z.url(),
    number: z.number().int().positive(),
    title: z.string(),
    state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
    baseRefName: z.string(),
    headRefName: z.string(),
  }),
);
export type GitHub = (cwd: string, args: string[]) => Promise<string>;
export const github: GitHub = async (cwd, args) =>
  (
    await execute(await discover('gh', ''), args, {
      cwd,
      env: { ...agentEnvironment(), GH_PROMPT_DISABLED: '1' },
      timeout: 60000,
      maxBuffer: 2 * 1024 * 1024,
    })
  ).stdout;
async function repository(cwd: string) {
  const remote = (await git(cwd, ['config', '--get', 'remote.origin.url'])).trim();
  const match = remote.match(
    /^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?$/,
  );
  if (!match) throw new Error('PR operations require a github.com origin remote');
  return match[1];
}
async function published(cwd: string, branch: string, sha: string) {
  const remote = await git(cwd, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]);
  if (remote.split(/\s/)[0] !== sha)
    throw new Error(
      'Publish this exact branch commit to origin before creating a PR. Moose does not push automatically.',
    );
}
export async function pullRequestPreview(
  cwd: string,
  base: string,
  gh: GitHub = github,
): Promise<PullRequestPreview> {
  await ordinaryGit(cwd);
  await git(cwd, ['check-ref-format', '--branch', base]);
  const repo = await repository(cwd),
    branch = await branchAt(cwd),
    head = await commitAt(cwd);
  if (base === branch) throw new Error('Choose a different PR base branch');
  await published(cwd, branch, head);
  const baseCommit = (
    await git(cwd, ['ls-remote', '--heads', 'origin', `refs/heads/${base}`])
  ).split(/\s/)[0];
  if (!/^[0-9a-f]{40,64}$/.test(baseCommit))
    throw new Error('Base branch does not exist on origin');
  // Fetch only the selected base; no branch checkout, merge or user index changes.
  await git(cwd, ['fetch', '--no-tags', 'origin', `refs/heads/${base}`]);
  await commitAt(cwd, baseCommit);
  const [commits, diff, existing] = await Promise.all([
    git(cwd, ['log', '--oneline', `${baseCommit}..${head}`]),
    git(cwd, [
      'diff',
      '--no-relative',
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      `${baseCommit}...${head}`,
    ]),
    gh(cwd, [
      'pr',
      'list',
      '--repo',
      repo,
      '--head',
      branch,
      '--base',
      base,
      '--state',
      'all',
      '--json',
      'url,number,title,state,baseRefName,headRefName',
    ]),
  ]);
  return {
    repository: repo,
    branch,
    head,
    base,
    baseCommit,
    commits,
    diff: diff.slice(0, 256_000),
    truncated: diff.length > 256_000,
    existing: pullRequests.parse(JSON.parse(existing)),
  };
}
export async function createPullRequest(
  cwd: string,
  expected: PullRequestTarget,
  title: string,
  body: string,
  gh: GitHub = github,
) {
  const current = await pullRequestPreview(cwd, expected.base, gh);
  if (
    (['repository', 'branch', 'head', 'baseCommit'] as const).some(
      (key) => current[key] !== expected[key],
    )
  )
    throw new Error('PR target changed. Refresh and review again.');
  const existing = current.existing.find((pr) => pr.state === 'OPEN');
  if (existing) return existing.url;
  if (!current.commits.trim()) throw new Error('There are no commits to propose');
  const dir = await mkdtemp(join(tmpdir(), 'moose-pr-'));
  try {
    const path = join(dir, 'body.md');
    await writeFile(path, body, { mode: 0o600 });
    const result = (
      await gh(cwd, [
        'pr',
        'create',
        '--repo',
        current.repository,
        '--base',
        current.base,
        '--head',
        current.branch,
        '--title',
        title,
        '--body-file',
        path,
        '--draft',
      ])
    ).trim();
    const url = result
      .split('\n')
      .find(
        (line) =>
          line.startsWith(`https://github.com/${current.repository}/pull/`) &&
          /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(line),
      );
    if (!url) throw new Error('PR result unknown. Refresh PR status before retrying.');
    return url;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
