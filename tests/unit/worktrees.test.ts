import { afterEach, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../../electron/db/store';
import { MooseService } from '../../electron/service';
import type { AgentAdapter, RunContext } from '../../electron/providers/types';
import type { Session } from '../../shared/types';
import type { WorktreeStatus } from '../../shared/worktrees';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
function git(cwd: string, ...args: string[]) {
  return execFileSync('/usr/bin/git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
class Agent implements AgentAdapter {
  context?: RunContext;
  finish = () => {};
  async probe() {
    return { models: [], modes: [] };
  }
  async run(context: RunContext) {
    this.context = context;
    writeFileSync(join(context.cwd, 'agent.txt'), context.text);
    await new Promise<void>((resolve) => {
      this.finish = resolve;
    });
  }
  respond() {}
  async cancel() {
    this.finish();
  }
  async close() {
    this.finish();
  }
}
function fixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'moose-worktrees-'))),
    root = join(dir, 'project');
  mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(root, 'base.txt'), 'base\n');
  writeFileSync(join(root, '.gitignore'), 'ignored/\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'base');
  const agents: Agent[] = [];
  const f = {
    dir,
    root,
    store: new Store(join(dir, 'db')),
    service: undefined as unknown as MooseService,
    agents,
  };
  const start = () => {
    f.service = new MooseService(
      f.store,
      () => {},
      () => {
        const agent = new Agent();
        agents.push(agent);
        return agent;
      },
    );
  };
  start();
  const project = f.store.addProject(root);
  cleanup.push(async () => {
    await f.service.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return Object.assign(f, {
    project,
    create: (branch = `moose/${randomUUID()}`) =>
      f.service.handle('worktreeCreate', {
        projectId: project.id,
        provider: 'codex',
        ref: 'HEAD',
        branch,
        requestId: randomUUID(),
      }) as Promise<Session>,
    status: (id: string) => f.service.handle('worktreeStatus', { id }) as Promise<WorktreeStatus>,
    restart: async () => {
      await f.service.close();
      f.store = new Store(join(dir, 'db'));
      start();
    },
  });
}
it('runs two worktrees concurrently, serializes shared checkouts and scopes references and diff', async () => {
  const f = fixture(),
    a = await f.create(),
    b = await f.create();
  const aPath = f.store.directory(f.project.id, a.id),
    bPath = f.store.directory(f.project.id, b.id);
  const follow = f.store.createSession(f.project.id, 'codex');
  f.store.updateSession(follow.id, { worktreeId: a.worktreeId });
  await f.service.handle('send', { sessionId: a.id, text: 'first' });
  await f.service.handle('send', { sessionId: b.id, text: 'parallel' });
  await f.service.handle('send', { sessionId: follow.id, text: 'later' });
  await vi.waitFor(() => expect(f.agents.filter((agent) => agent.context)).toHaveLength(2));
  expect(readFileSync(join(aPath, 'agent.txt'), 'utf8')).toBe('first');
  expect(readFileSync(join(bPath, 'agent.txt'), 'utf8')).toBe('parallel');
  expect(existsSync(join(f.root, 'agent.txt'))).toBe(false);
  const files = await f.service.handle('searchFiles', {
    projectId: f.project.id,
    sessionId: a.id,
    query: 'agent',
  });
  expect(files).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'agent.txt' })]));
  const diff = await f.service.handle('gitDiff', {
    projectId: f.project.id,
    sessionId: b.id,
    path: 'agent.txt',
    area: 'untracked',
  });
  expect(diff).toMatchObject({ text: expect.stringContaining('parallel') });
  await expect(f.service.handle('worktreeRemove', { id: a.worktreeId })).rejects.toThrow('tasks');
  f.agents[0].finish();
  await vi.waitFor(() => expect(f.agents.filter((agent) => agent.context)).toHaveLength(3));
  expect(f.agents[2].context?.cwd).toBe(aPath);
});
it('blocks cleanup for dirty, ignored, retained and unmerged work, preserving the branch on clean removal', async () => {
  const f = fixture(),
    s = await f.create(),
    id = s.worktreeId!,
    path = f.store.directory(f.project.id, s.id);
  writeFileSync(join(path, 'new.txt'), 'keep');
  await expect(f.service.handle('worktreeRemove', { id })).rejects.toThrow('modified');
  rmSync(join(path, 'new.txt'));
  mkdirSync(join(path, 'ignored'));
  writeFileSync(join(path, 'ignored/file'), 'keep');
  await expect(f.service.handle('worktreeRemove', { id })).rejects.toThrow('ignored');
  rmSync(join(path, 'ignored'), { recursive: true });
  await f.service.handle('worktreeKeep', { id, kept: true });
  await expect(f.service.handle('worktreeRemove', { id })).rejects.toThrow('Keep');
  await f.service.handle('worktreeKeep', { id, kept: false });
  writeFileSync(join(path, 'new.txt'), 'commit');
  git(path, 'add', '.');
  git(path, 'commit', '-qm', 'new');
  await expect(f.service.handle('worktreeRemove', { id })).rejects.toThrow('not merged');
  git(f.root, 'merge', '--ff-only', f.store.worktree(id).branch);
  await f.service.handle('worktreeRemove', { id });
  expect(existsSync(path)).toBe(false);
  expect(git(f.root, 'rev-parse', f.store.worktree(id).branch)).toBeTruthy();
  await expect(
    f.service.handle('send', { sessionId: s.id, text: 'unsafe fallback' }),
  ).rejects.toThrow('unavailable');
});
it('previews and commits a pinned merge, rejecting stale previews and keeping pending directories idle', async () => {
  const f = fixture(),
    s = await f.create(),
    id = s.worktreeId!,
    path = f.store.directory(f.project.id, s.id);
  writeFileSync(join(path, 'new.txt'), 'new');
  git(path, 'add', '.');
  git(path, 'commit', '-qm', 'feature');
  const stale = await f.status(id);
  git(f.root, 'commit', '--allow-empty', '-qm', 'target moved');
  const args = (p: WorktreeStatus) => ({
    id,
    sourceCommit: p.sourceCommit,
    targetCommit: p.targetCommit,
    targetBranch: p.targetBranch,
  });
  await expect(f.service.handle('worktreeMerge', args(stale))).rejects.toThrow('stale');
  const preview = await f.status(id);
  expect(preview.changes).toContain('+new');
  const pending = (await f.service.handle('worktreeMerge', args(preview))) as WorktreeStatus;
  expect(pending.worktree.merge?.state).toBe('pending');
  await expect(f.service.handle('send', { sessionId: s.id, text: 'blocked' })).rejects.toThrow(
    'history operation',
  );
  await expect(
    f.service.handle('worktreeComplete', { id, indexFingerprint: '0'.repeat(64) }),
  ).rejects.toThrow('changed');
  const complete = (await f.service.handle('worktreeComplete', {
    id,
    indexFingerprint: pending.indexFingerprint,
  })) as WorktreeStatus;
  expect(complete.worktree.merge?.state).toBe('complete');
  expect(readFileSync(join(f.root, 'new.txt'), 'utf8')).toBe('new');
});
it('retains merge conflicts across restart, stages only actual conflicts and supports completion and abort', async () => {
  const f = fixture(),
    s = await f.create(),
    id = s.worktreeId!,
    path = f.store.directory(f.project.id, s.id);
  writeFileSync(join(path, 'base.txt'), 'source\n');
  git(path, 'commit', '-qam', 'source');
  writeFileSync(join(f.root, 'base.txt'), 'target\n');
  git(f.root, 'commit', '-qam', 'target');
  const p = await f.status(id),
    args = {
      id,
      sourceCommit: p.sourceCommit,
      targetCommit: p.targetCommit,
      targetBranch: p.targetBranch,
    };
  await f.service.handle('worktreeMerge', args);
  await f.restart();
  expect((await f.status(id)).conflicts).toEqual(['base.txt']);
  await expect(f.service.handle('worktreeResolve', { id, path: '../../outside' })).rejects.toThrow(
    'not an unresolved',
  );
  await f.service.handle('worktreeAbort', { id });
  expect(readFileSync(join(f.root, 'base.txt'), 'utf8')).toBe('target\n');
  await f.service.handle('worktreeMerge', args);
  writeFileSync(join(f.root, 'base.txt'), 'resolved\n');
  const resolved = (await f.service.handle('worktreeResolve', {
    id,
    path: 'base.txt',
  })) as WorktreeStatus;
  await f.service.handle('worktreeComplete', { id, indexFingerprint: resolved.indexFingerprint });
  expect(readFileSync(join(f.root, 'base.txt'), 'utf8')).toBe('resolved\n');
});
it('does not follow a replaced worktree symlink and recovers interrupted metadata without replay', async () => {
  const f = fixture(),
    s = await f.create(),
    id = s.worktreeId!,
    w = f.store.worktree(id);
  f.store.saveWorktree({ ...w, status: 'creating' });
  await f.restart();
  expect((await f.status(id)).worktree.status).toBe('ready');
  const alias = join(f.dir, 'alias');
  symlinkSync(f.root, alias);
  const same = await f.service.addProject(alias);
  expect(same.id).toBe(f.project.id);
  git(f.root, 'worktree', 'remove', w.path);
  symlinkSync(f.root, w.path);
  await expect(
    f.service.handle('send', { sessionId: s.id, text: 'wrong directory' }),
  ).rejects.toThrow('symbolic link');
  await expect(f.service.handle('worktreeRemove', { id })).rejects.toThrow('registration');
  expect(existsSync(join(f.root, 'base.txt'))).toBe(true);
});
it('deduplicates successful creation and preserves recoverable records after Git rejects creation', async () => {
  const f = fixture(),
    request = {
      projectId: f.project.id,
      provider: 'codex',
      ref: 'HEAD',
      branch: 'moose/once',
      requestId: randomUUID(),
    };
  const a = (await f.service.handle('worktreeCreate', request)) as Session;
  const b = (await f.service.handle('worktreeCreate', request)) as Session;
  expect(a.id).toBe(b.id);
  expect(f.store.listWorktrees(f.project.id)).toHaveLength(1);
  const failedId = randomUUID(),
    oldHead = git(f.root, 'rev-parse', 'main');
  await expect(
    f.service.handle('worktreeCreate', { ...request, requestId: failedId, branch: 'main' }),
  ).rejects.toThrow('not confirmed');
  expect(f.store.worktree(failedId).status).toBe('error');
  await f.restart();
  expect((await f.status(failedId)).worktree.status).toBe('error');
  await f.service.handle('worktreeRemove', { id: failedId });
  expect(git(f.root, 'rev-parse', 'main')).toBe(oldHead);
});
it('rejects dirty merge targets and never bypasses an existing Git operation', async () => {
  const f = fixture(),
    s = await f.create(),
    id = s.worktreeId!,
    path = f.store.directory(f.project.id, s.id);
  writeFileSync(join(path, 'feature.txt'), 'feature');
  git(path, 'add', '.');
  git(path, 'commit', '-qm', 'feature');
  const preview = await f.status(id),
    args = {
      id,
      sourceCommit: preview.sourceCommit,
      targetCommit: preview.targetCommit,
      targetBranch: preview.targetBranch,
    };
  writeFileSync(join(f.root, 'local.txt'), 'keep');
  await expect(f.service.handle('worktreeMerge', args)).rejects.toThrow('clean');
  expect(readFileSync(join(f.root, 'local.txt'), 'utf8')).toBe('keep');
  rmSync(join(f.root, 'local.txt'));
  writeFileSync(join(f.root, '.git/CHERRY_PICK_HEAD'), preview.sourceCommit);
  await expect(f.service.handle('worktreeMerge', args)).rejects.toThrow('clean');
});
it('preserves queued work and project ownership, then reconciles a missing clean checkout safely', async () => {
  const f = fixture(),
    s = await f.create(),
    id = s.worktreeId!,
    path = f.store.directory(f.project.id, s.id);
  const queued = f.store.enqueue(s.id, 'Keep pending');
  await expect(f.service.handle('worktreeRemove', { id })).rejects.toThrow('queued');
  await expect(f.service.handle('deleteProject', { projectId: f.project.id })).rejects.toThrow(
    'worktrees',
  );
  f.store.updateQueue(queued.id, undefined, true);
  rmSync(path, { recursive: true });
  await f.service.handle('worktreeRemove', { id });
  expect(f.store.worktree(id).status).toBe('removed');
  expect(git(f.root, 'rev-parse', f.store.worktree(id).branch)).toBeTruthy();
  await f.service.handle('deleteProject', { projectId: f.project.id });
  expect(existsSync(join(f.root, 'base.txt'))).toBe(true);
});
