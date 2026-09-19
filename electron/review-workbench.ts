import { RpcRejected } from './providers/rpc';
import { createHash } from 'node:crypto';
import { Store } from './db/store';
import { commitPreview, commitReviewed, stageFile, ordinaryGit } from './git-actions';
import { createPullRequest, pullRequestPreview } from './pull-requests';
import { commitAt } from './worktree-git';
import type { AgentAdapter } from './providers/types';
import type { CodeReview } from '../shared/git-actions';
import type { Requests, Provider } from '../shared/types';

type Method =
  | 'gitStage'
  | 'gitCommitPreview'
  | 'gitCommit'
  | 'prPreview'
  | 'prCreate'
  | 'reviewStart'
  | 'reviewList'
  | 'reviewStop';
export const isReviewMethod = (method: string): method is Method =>
  [
    'gitStage',
    'gitCommitPreview',
    'gitCommit',
    'prPreview',
    'prCreate',
    'reviewStart',
    'reviewList',
    'reviewStop',
  ].includes(method);
type Command = { [K in Method]: { method: K; args: Requests[K] } }[Method];
interface Receipt {
  fingerprint: string;
  status: 'running' | 'done' | 'unknown';
  result?: unknown;
  error?: string;
  projectId: string;
  intent: Command;
}
interface Hooks {
  lock(path: string): () => void;
  changed(): void;
  adapter(provider: Provider): Promise<AgentAdapter>;
}
/** 工作目录写入共享锁；提交/PR 意图落库，审查单独保存，重启绝不重放。 */
export class ReviewWorkbench {
  private pending = new Set<Promise<unknown>>();
  private reviews = new Map<string, { adapter: AgentAdapter; review: CodeReview }>();
  private stopped = false;
  constructor(
    private store: Store,
    private hooks: Hooks,
  ) {
    for (const row of this.rows('workbench:')) {
      const receipt = JSON.parse(row.value) as Receipt;
      if (receipt.status === 'running')
        this.save(row.key, {
          ...receipt,
          status: 'unknown',
          error: 'Moose restarted before confirmation. Check Git / PR state before retrying.',
        });
    }
    for (const row of this.rows('code-review:')) {
      const review = JSON.parse(row.value) as CodeReview;
      if (review.status === 'running')
        this.save(row.key, {
          ...review,
          status: 'unknown',
          error: 'Review interrupted by restart; not automatically resumed.',
        });
    }
  }
  private rows(prefix: string) {
    return this.store.sqlite
      .prepare('SELECT key,value FROM settings WHERE key LIKE ?')
      .all(`${prefix}%`) as { key: string; value: string }[];
  }
  private load<T>(key: string): T | undefined {
    const row = this.store.sqlite.prepare('SELECT value FROM settings WHERE key=?').get(key) as
      | { value: string }
      | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  }
  private save(key: string, value: unknown) {
    this.store.sqlite
      .prepare(
        'INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, JSON.stringify(value));
  }
  private track<T>(promise: Promise<T>) {
    this.pending.add(promise);
    void promise.finally(() => this.pending.delete(promise)).catch(() => {});
    return promise;
  }
  handle(method: Method, args: unknown) {
    return this.track(this.dispatch({ method, args } as Command));
  }
  private async receipt(
    id: string,
    projectId: string,
    args: Command,
    body: () => Promise<unknown>,
  ) {
    const key = `workbench:${id}`,
      fingerprint = createHash('sha256').update(JSON.stringify(args)).digest('hex');
    const old = this.load<Receipt>(key);
    if (old) {
      if (old.fingerprint !== fingerprint) throw new Error('Request ID was already used');
      if (old.status === 'done') return old.result;
      throw new Error(old.error || 'Operation already started; refresh its state before retrying');
    }
    const record: Receipt = { fingerprint, status: 'running', projectId, intent: args };
    this.save(key, record);
    try {
      const result = await body();
      this.save(key, { ...record, status: 'done', result });
      return result;
    } catch (error) {
      this.save(key, { ...record, status: 'unknown', error: String(error) });
      throw error;
    }
  }
  private async dispatch(command: Command): Promise<unknown> {
    if (this.stopped) throw new Error('Moose is shutting down');
    const { args } = command;
    if (command.method === 'reviewStop') {
      const review = this.load<CodeReview>(`code-review:${command.args.id}`);
      if (!review || review.projectId !== args.projectId) throw new Error('Review not found');
      this.store.project(args.projectId);
      const active = this.reviews.get(review.id);
      if (active) {
        active.review.status = 'cancelled';
        this.save(`code-review:${review.id}`, active.review);
        await active.adapter.cancel();
      }
      return null;
    }
    const cwd = this.store.directory(
      args.projectId,
      'sessionId' in args ? args.sessionId : undefined,
    );
    if (command.method === 'reviewList')
      return this.rows('code-review:')
        .map((row) => JSON.parse(row.value) as CodeReview)
        .filter((r) => r.projectId === args.projectId && r.cwd === cwd)
        .sort((a, b) => b.createdAt - a.createdAt);
    const unlock = this.hooks.lock(cwd);
    let transferred = false;
    try {
      switch (command.method) {
        case 'gitStage':
          await stageFile(cwd, command.args.path, command.args.staged);
          return null;
        case 'gitCommitPreview':
          return await commitPreview(cwd);
        case 'gitCommit':
          return await this.receipt(command.args.requestId, args.projectId, command, () =>
            commitReviewed(cwd, command.args.preview, command.args.message),
          );
        case 'prPreview':
          return await pullRequestPreview(cwd, command.args.base);
        case 'prCreate':
          return await this.receipt(command.args.requestId, args.projectId, command, () =>
            createPullRequest(cwd, command.args.preview, command.args.title, command.args.body),
          );
        case 'reviewStart': {
          const source = this.store.session(command.args.sessionId);
          if (source.provider !== 'codex')
            throw new Error('Native code review is currently available for Codex only');
          const key = `code-review:${command.args.requestId}`,
            old = this.load<CodeReview>(key);
          if (old) {
            if (
              old.sessionId !== source.id ||
              JSON.stringify(old.target) !== JSON.stringify(command.args.target)
            )
              throw new Error('Review ID was already used');
            return old;
          }
          await ordinaryGit(cwd);
          const target = command.args.target;
          if (target.type === 'commit') await commitAt(cwd, target.sha);
          if (target.type === 'baseBranch') await commitAt(cwd, target.branch);
          const adapter = await this.hooks.adapter(source.provider);
          if (!adapter.review || this.stopped) {
            await adapter.close();
            throw new Error('Native review unavailable');
          }
          const review: CodeReview = {
            id: command.args.requestId,
            projectId: args.projectId,
            sessionId: source.id,
            cwd,
            target,
            status: 'running',
            text: '',
            createdAt: Date.now(),
          };
          this.save(key, review);
          this.reviews.set(review.id, { adapter, review });
          const chunks = new Map<string, string>();
          const run = adapter
            .review(
              {
                session: source,
                cwd,
                text: '',
                nativeId: (id) => {
                  review.nativeId = id;
                  this.save(key, review);
                },
                emit: (event) => {
                  if (event.kind !== 'assistant' || review.status !== 'running') return;
                  chunks.set(
                    event.key,
                    event.text ?? `${chunks.get(event.key) || ''}${event.delta || ''}`,
                  );
                  review.text = [...chunks.values()].join('\n\n').slice(0, 500_000);
                  this.save(key, review);
                },
              },
              target,
            )
            .then(() => {
              if (review.status === 'running') review.status = 'completed';
            })
            .catch((error) => {
              if (review.status === 'running') {
                review.status = error instanceof RpcRejected ? 'failed' : 'unknown';
                review.error = String(error);
              }
            })
            .finally(async () => {
              try {
                await adapter.close();
              } finally {
                this.reviews.delete(review.id);
                this.save(key, review);
                unlock();
                this.hooks.changed();
              }
            });
          transferred = true;
          void this.track(run);
          return review;
        }
      }
    } finally {
      if (!transferred) unlock();
      this.hooks.changed();
    }
  }
  async close() {
    this.stopped = true;
    await Promise.all(
      [...this.reviews.values()].map(async ({ review, adapter }) => {
        if (review.status === 'running') {
          review.status = 'unknown';
          review.error = 'Moose closed before review completion; not automatically resumed.';
          this.save(`code-review:${review.id}`, review);
        }
        await adapter.cancel();
      }),
    );
    await Promise.allSettled(this.pending);
  }
}
