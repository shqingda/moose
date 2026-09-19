import { mkdir, lstat, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Requests, Session } from '../shared/types';
import type { Worktree, WorktreeStatus } from '../shared/worktrees';
import { Store } from './db/store';
import { git } from './git';
import {
  branchAt,
  commitAt,
  commonDirectory,
  gitOperationPending,
  conflicts,
  dirty,
  indexFingerprint,
  isAncestor,
  mergeHead,
  registeredWorktrees,
} from './worktree-git';

type Hooks = { lock(paths: string[]): () => void; busy(path: string): boolean; changed(): void };
const methods = [
  'worktreeList',
  'worktreeCreate',
  'worktreeStatus',
  'worktreeKeep',
  'worktreeRemove',
  'worktreeMerge',
  'worktreeResolve',
  'worktreeComplete',
  'worktreeAbort',
] as const;
export type WorktreeMethod = (typeof methods)[number];
type Command = { [K in WorktreeMethod]: { method: K; args: Requests[K] } }[WorktreeMethod];
export const isWorktreeMethod = (method: string): method is WorktreeMethod =>
  (methods as readonly string[]).includes(method);
const pendingMerge = (w: Worktree) =>
  !!w.merge && ['starting', 'pending', 'conflicts', 'unknown'].includes(w.merge.state);

/** 管理目录与 Git 生命周期；磁盘变更之前保存意图，恢复只核对现场，不自动重放。 */
export class Worktrees {
  private pending = new Set<Promise<unknown>>();
  constructor(
    private store: Store,
    private hooks: Hooks,
  ) {}
  blocks(path: string) {
    return this.store
      .listProjects()
      .some((p) =>
        this.store
          .listWorktrees(p.id)
          .some((w) => pendingMerge(w) && (w.path === path || w.merge?.targetPath === path)),
      );
  }
  private save(w: Worktree) {
    const result = this.store.saveWorktree(w);
    this.hooks.changed();
    return result;
  }
  /** Read-side recovery must not overwrite a newer create, cleanup or merge result. */
  private reconcile(before: Worktree, after: Worktree) {
    const current = this.store.worktree(before.id);
    if (
      this.hooks.busy(before.path) ||
      this.hooks.busy(this.root(before)) ||
      JSON.stringify(current) !== JSON.stringify(before)
    )
      return current;
    return JSON.stringify(current) === JSON.stringify(after) ? current : this.save(after);
  }
  private root(w: Worktree) {
    return this.store.directory(w.projectId);
  }
  private queued(path: string) {
    return this.store.queued().some((q) => {
      const s = this.store.session(q.sessionId);
      return (
        (s.worktreeId
          ? this.store.worktree(s.worktreeId).path
          : this.store.project(s.projectId).path) === path
      );
    });
  }
  private idle(paths: string[]) {
    if (paths.some((path) => this.hooks.busy(path) || this.queued(path)))
      throw new Error('Finish or remove queued tasks before changing this worktree');
    return this.hooks.lock(paths);
  }
  async ensure(session: Session) {
    const cwd = this.store.directory(session.projectId, session.id);
    if (session.worktreeId) await this.verify(this.store.worktree(session.worktreeId));
    if (this.blocks(cwd))
      throw new Error(
        'Complete or abort the pending merge before running an agent in this directory',
      );
    return cwd;
  }
  private async verify(w: Worktree) {
    const root = this.root(w);
    const entry = (await registeredWorktrees(root)).find((entry) => entry.path === w.path);
    if (
      !entry ||
      entry.branch !== `refs/heads/${w.branch}` ||
      (await realpath(w.path)) !== w.path ||
      (await commonDirectory(w.path)) !== (await commonDirectory(root))
    )
      throw new Error(
        'Managed worktree no longer matches its Git registration; files were preserved',
      );
    return root;
  }
  async handle(method: WorktreeMethod, input: unknown) {
    const pending = this.dispatch({ method, args: input } as Command);
    this.pending.add(pending);
    try {
      return await pending;
    } finally {
      this.pending.delete(pending);
    }
  }
  private async dispatch(command: Command): Promise<unknown> {
    const { method, args } = command;
    if (method === 'worktreeList') return this.store.listWorktrees(args.projectId);
    if (method === 'worktreeCreate') return this.create(args);
    if (method === 'worktreeStatus') return this.status(args.id);
    if (method === 'worktreeKeep') {
      const w = this.store.worktree(args.id);
      if (this.hooks.busy(w.path) || this.hooks.busy(this.root(w)))
        throw new Error('Wait for directory operations to finish');
      return this.save({ ...w, kept: args.kept });
    }
    if (method === 'worktreeRemove') return this.remove(args.id);
    if (method === 'worktreeMerge') return this.merge(args);
    return this.finish(command);
  }
  private async create(a: Requests['worktreeCreate']) {
    const existing = this.store.listWorktrees(a.projectId).find((w) => w.id === a.requestId);
    if (existing) {
      if (existing.branch !== a.branch || existing.baseRef !== a.ref)
        throw new Error('Creation request ID has already been used');
      const session = this.store
        .listSessions()
        .find((s) => s.worktreeId === existing.id && s.provider === a.provider);
      if (!session || (await this.status(existing.id)).worktree.status !== 'ready')
        throw new Error(
          'Creation was not confirmed. Check the worktree status; it will not be recreated automatically',
        );
      return session;
    }
    const root = this.store.directory(a.projectId),
      unlock = this.idle([root]);
    try {
      if (this.blocks(root)) throw new Error('Complete or abort the pending merge first');
      if ((await realpath((await git(root, ['rev-parse', '--show-toplevel'])).trim())) !== root)
        throw new Error('Add the repository root as a project before creating worktrees');
      await git(root, ['check-ref-format', `refs/heads/${a.branch}`]);
      const baseCommit = await commitAt(root, a.ref);
      const parent = join(dirname(this.store.sqlite.name), 'worktrees', a.projectId);
      await mkdir(parent, { recursive: true });
      const path = join(await realpath(parent), a.requestId);
      const w: Worktree = {
        id: a.requestId,
        projectId: a.projectId,
        path,
        branch: a.branch,
        baseRef: a.ref,
        baseCommit,
        status: 'creating',
        kept: false,
        error: '',
        createdAt: Date.now(),
      };
      const session = this.store.sqlite.transaction(() => {
        this.store.saveWorktree(w);
        const created = this.store.createSession(a.projectId, a.provider);
        return this.store.updateSession(created.id, { worktreeId: w.id, title: a.branch });
      })();
      this.hooks.changed();
      try {
        await git(root, ['worktree', 'add', '-b', a.branch, path, baseCommit]);
        await this.verify(w);
        this.save({ ...w, status: 'ready' });
        return session;
      } catch (error) {
        this.save({ ...w, status: 'error', error: String(error) });
        throw new Error(
          `Worktree creation was not confirmed. Inspect its saved status before retrying. ${String(error)}`,
        );
      }
    } finally {
      unlock();
    }
  }
  /** 核对中断的创建／删除与合并现场，不凭数据库状态重做 Git 变更。 */
  async status(id: string): Promise<WorktreeStatus> {
    let w = this.store.worktree(id);
    const result: WorktreeStatus = {
      worktree: w,
      sourceCommit: '',
      targetCommit: '',
      targetBranch: '',
      dirty: false,
      merged: false,
      changes: '',
      truncated: false,
      conflicts: [],
      indexFingerprint: '',
    };
    if (w.status === 'removed') return result;
    try {
      const root = this.root(w);
      if (
        !this.hooks.busy(w.path) &&
        !this.hooks.busy(root) &&
        ['creating', 'removing', 'error'].includes(w.status)
      ) {
        const registered = (await registeredWorktrees(root)).some((entry) => entry.path === w.path);
        if (
          !registered &&
          !(await lstat(w.path).catch((e) => {
            if (e.code === 'ENOENT') return null;
            throw e;
          }))
        ) {
          if (w.status === 'removing')
            w = this.reconcile(w, { ...w, status: 'removed', error: '' });
          else
            w = this.reconcile(w, {
              ...w,
              status: 'error',
              error:
                'No worktree exists at the saved path. Remove this record or create a new worktree.',
            });
          return { ...result, worktree: w };
        }
        await this.verify(w);
        w = this.reconcile(w, { ...w, status: 'ready', error: '' });
      }
      await this.verify(w);
      const [sourceCommit, targetCommit, targetBranch, isDirty, unresolved, fingerprint] =
        await Promise.all([
          commitAt(w.path),
          commitAt(root),
          branchAt(root),
          dirty(w.path),
          conflicts(root),
          indexFingerprint(root),
        ]);
      if (pendingMerge(w) && !this.hooks.busy(root)) {
        const head = await mergeHead(root);
        const state =
          head === w.merge!.sourceCommit &&
          targetCommit === w.merge!.targetCommit &&
          targetBranch === w.merge!.targetBranch
            ? unresolved.length
              ? 'conflicts'
              : 'pending'
            : !head && targetCommit === w.merge!.targetCommit && !(await dirty(root))
              ? 'aborted'
              : !head &&
                  targetCommit !== w.merge!.targetCommit &&
                  (await isAncestor(root, w.merge!.sourceCommit, targetCommit))
                ? 'complete'
                : 'unknown';
        if (state !== w.merge!.state)
          w = this.reconcile(w, { ...w, merge: { ...w.merge!, state } });
      }
      const range = pendingMerge(w) ? ['--cached'] : [`${targetCommit}...${sourceCommit}`];
      const fullDiff = await git(root, [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--stat',
        '--patch',
        ...range,
      ]);
      if (pendingMerge(w) && (await indexFingerprint(root)) !== fingerprint)
        throw new Error('The staged merge changed while loading the preview; refresh it');
      const changes = fullDiff.slice(0, 256000);
      return {
        worktree: w,
        sourceCommit,
        targetCommit,
        targetBranch,
        dirty: isDirty,
        truncated: fullDiff.length > changes.length,
        merged: await isAncestor(root, sourceCommit, targetCommit),
        changes,
        conflicts: unresolved,
        indexFingerprint: fingerprint,
      };
    } catch (error) {
      return { ...result, worktree: w, error: String(error) };
    }
  }
  private async remove(id: string) {
    let w = this.store.worktree(id);
    if (w.status === 'removed') return w;
    if (w.kept) throw new Error('Disable Keep before removing this worktree');
    if (pendingMerge(w)) throw new Error('Complete or abort the pending merge first');
    const root = this.root(w),
      unlock = this.idle([root, w.path]);
    try {
      const registered = (await registeredWorktrees(root)).find((entry) => entry.path === w.path);
      const exists = await lstat(w.path).catch((e) => {
        if (e.code === 'ENOENT') return null;
        throw e;
      });
      if (!registered && !exists) return this.save({ ...w, status: 'removed', error: '' });
      if (registered && !exists) {
        if (
          registered.branch !== `refs/heads/${w.branch}` ||
          !(await isAncestor(
            root,
            await commitAt(root, `refs/heads/${w.branch}`),
            await commitAt(root),
          ))
        )
          throw new Error(
            'Missing worktree still has unmerged or changed Git registration; its branch is retained',
          );
        w = this.save({ ...w, status: 'removing', error: '' });
        await git(root, ['worktree', 'remove', '--', w.path]);
        return this.save({ ...w, status: 'removed' });
      }
      await this.verify(w);
      if (await dirty(w.path, true))
        throw new Error(
          'Worktree has modified, untracked or ignored files; preserve or remove them yourself first',
        );
      if (!(await isAncestor(root, await commitAt(w.path), await commitAt(root))))
        throw new Error('Worktree has commits not merged into the project branch');
      if (await gitOperationPending(w.path))
        throw new Error('Worktree has an unfinished Git operation');
      w = this.save({ ...w, status: 'removing', error: '' });
      await git(root, ['worktree', 'remove', '--', w.path]);
      return this.save({ ...w, status: 'removed' });
    } catch (error) {
      if (w.status === 'removing') this.save({ ...w, error: String(error) });
      throw error;
    } finally {
      unlock();
    }
  }
  private async merge(a: Requests['worktreeMerge']) {
    let w = this.store.worktree(a.id);
    const root = this.root(w),
      unlock = this.idle([root, w.path]);
    try {
      if (w.status !== 'ready' || this.blocks(root) || this.blocks(w.path))
        throw new Error('A worktree or merge is not ready');
      await this.verify(w);
      if (
        (await dirty(w.path)) ||
        (await dirty(root)) ||
        (await gitOperationPending(root)) ||
        (await gitOperationPending(w.path))
      )
        throw new Error('Source and target must be clean with no pending merge');
      const [sourceCommit, targetCommit, targetBranch] = await Promise.all([
        commitAt(w.path),
        commitAt(root),
        branchAt(root),
      ]);
      if (
        sourceCommit !== a.sourceCommit ||
        targetCommit !== a.targetCommit ||
        targetBranch !== a.targetBranch
      )
        throw new Error('Merge preview is stale. Refresh and review it again');
      if (await isAncestor(root, sourceCommit, targetCommit)) return await this.status(w.id);
      w = this.save({
        ...w,
        merge: { targetPath: root, targetBranch, targetCommit, sourceCommit, state: 'starting' },
      });
      try {
        await git(root, [
          'merge',
          '--no-ff',
          '--no-commit',
          '--no-overwrite-ignore',
          '--',
          sourceCommit,
        ]);
      } catch (error) {
        if ((await mergeHead(root)) !== sourceCommit) {
          this.save({ ...w, merge: { ...w.merge!, state: 'unknown' }, error: String(error) });
          throw error;
        }
      }
      w = this.save({
        ...w,
        merge: { ...w.merge!, state: (await conflicts(root)).length ? 'conflicts' : 'pending' },
        error: '',
      });
      return await this.status(w.id);
    } finally {
      unlock();
    }
  }
  private async finish(
    command: Extract<Command, { method: 'worktreeResolve' | 'worktreeComplete' | 'worktreeAbort' }>,
  ) {
    const { method, args: a } = command;
    let w = this.store.worktree(a.id);
    const root = this.root(w),
      unlock = this.idle([root, w.path]);
    try {
      const merge = w.merge;
      if (!merge || !pendingMerge(w) || merge.targetPath !== root)
        throw new Error('No pending merge is recorded for this worktree');
      if (
        (await branchAt(root)) !== merge.targetBranch ||
        (await commitAt(root)) !== merge.targetCommit ||
        (await mergeHead(root)) !== merge.sourceCommit
      )
        throw new Error(
          'Git merge state changed externally; inspect it in your editor before continuing',
        );
      if (method === 'worktreeResolve') {
        if (!(await conflicts(root)).includes(a.path))
          throw new Error('This path is not an unresolved merge conflict');
        await git(root, ['add', '--', a.path]);
        w = this.save({
          ...w,
          merge: { ...merge, state: (await conflicts(root)).length ? 'conflicts' : 'pending' },
        });
      } else if (method === 'worktreeComplete') {
        if ((await conflicts(root)).length) throw new Error('Resolve all merge conflicts first');
        if ((await indexFingerprint(root)) !== a.indexFingerprint)
          throw new Error('Staged merge changes changed. Refresh and review them again');
        if ((await git(root, ['diff', '--name-only'])).trim())
          throw new Error('Unstaged changes remain; review them before completing the merge');
        await git(root, ['commit', '-m', `Merge ${w.branch}`]);
        w = this.save({ ...w, merge: { ...merge, state: 'complete' }, error: '' });
      } else {
        await git(root, ['merge', '--abort']);
        w = this.save({ ...w, merge: { ...merge, state: 'aborted' }, error: '' });
      }
      return await this.status(w.id);
    } finally {
      unlock();
    }
  }
  async close() {
    await Promise.allSettled(this.pending);
  }
}
