import { afterEach, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../../electron/db/store';
import { MooseService } from '../../electron/service';
import { CodexAdapter } from '../../electron/providers/codex';
import { ReviewWorkbench } from '../../electron/review-workbench';
import type { CodeReview, CommitPreview } from '../../shared/git-actions';
import type { AgentAdapter, RunContext } from '../../electron/providers/types';
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
function fixture() {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'moose-review-workbench-')));
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'config', 'user.name', 'Test');
  git(cwd, 'config', 'user.email', 'test@example.invalid');
  git(cwd, 'config', 'commit.gpgsign', 'false');
  git(cwd, 'commit', '--allow-empty', '-qm', 'base');
  const store = new Store(join(cwd, 'data.sqlite'));
  store.setSettings({ codexPath: resolve('tests/fixtures/agent.mjs') });
  const project = store.addProject(cwd),
    session = store.createSession(project.id, 'codex');
  const service = new MooseService(store, () => {});
  cleanup.push(async () => {
    await service.close();
    rmSync(cwd, { recursive: true, force: true });
  });
  return {
    cwd,
    store,
    project,
    session,
    service,
    scope: { projectId: project.id, sessionId: session.id },
  };
}
it('deduplicates commits across retries without committing later staged files', async () => {
  const { cwd, scope, service } = fixture();
  writeFileSync(join(cwd, 'a.txt'), 'a');
  await service.handle('gitStage', { ...scope, path: 'a.txt', staged: true });
  const preview = (await service.handle('gitCommitPreview', scope)) as CommitPreview;
  const args = {
    ...scope,
    preview: { head: preview.head, branch: preview.branch, fingerprint: preview.fingerprint },
    message: 'first',
    requestId: randomUUID(),
  };
  const head = await service.handle('gitCommit', args);
  writeFileSync(join(cwd, 'b.txt'), 'b');
  git(cwd, 'add', 'b.txt');
  expect(await service.handle('gitCommit', args)).toBe(head);
  expect(git(cwd, 'log', '--format=%s', '-1')).toBe('first');
  expect(git(cwd, 'diff', '--cached', '--name-only')).toBe('b.txt');
  await expect(service.handle('gitCommit', { ...args, message: 'different' })).rejects.toThrow(
    'already used',
  );
});
it('runs native review on a new read-only thread, keeps result locations, and does not alter execution history', async () => {
  const { scope, session, store, service } = fixture();
  store.updateSession(session.id, { nativeId: 'execution-thread' });
  const request = { ...scope, target: { type: 'uncommittedChanges' }, requestId: randomUUID() };
  const review = (await service.handle('reviewStart', request)) as CodeReview;
  expect(review.status).toBe('running');
  await expect(
    service.handle('gitStage', { ...scope, path: 'a.txt', staged: true }),
  ).rejects.toThrow('Wait');
  await vi.waitFor(async () =>
    expect(((await service.handle('reviewList', scope)) as CodeReview[])[0].status).toBe(
      'completed',
    ),
  );
  const result = ((await service.handle('reviewList', scope)) as CodeReview[])[0];
  expect(result.text).toContain('src/example.ts:12');
  expect(result.nativeId).not.toBe('execution-thread');
  expect(store.session(session.id).nativeId).toBe('execution-thread');
  expect(store.allMessages(session.id)).toHaveLength(0);
  expect(((await service.handle('reviewStart', request)) as CodeReview).id).toBe(review.id);
  expect(await service.handle('reviewList', scope)).toHaveLength(1);
});
it('does not complete native review on another thread event and can stop the pending review', async () => {
  const adapter = new CodexAdapter(resolve('tests/fixtures/agent.mjs'));
  let done = false;
  const context = {
    cwd: process.cwd(),
    session: { model: 'fixture', effort: '', nativeId: 'original' },
    text: '',
    emit: () => {},
    nativeId: () => {},
  } as unknown as RunContext;
  const running = adapter.review(context, { type: 'commit', sha: 'deadbee' }).then(() => {
    done = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(done).toBe(false);
  await adapter.cancel();
  await running;
  await adapter.close();
});
it('recovers interrupted review and mutation records without replaying them', async () => {
  const { store, scope } = fixture();
  const review: CodeReview = {
    id: randomUUID(),
    ...scope,
    sessionId: scope.sessionId,
    cwd: store.directory(scope.projectId, scope.sessionId),
    target: { type: 'uncommittedChanges' },
    status: 'running',
    text: 'partial',
    createdAt: 0,
  };
  store.sqlite
    .prepare('INSERT INTO settings(key,value) VALUES (?,?)')
    .run(`code-review:${review.id}`, JSON.stringify(review));
  const adapter = vi.fn();
  const workbench = new ReviewWorkbench(store, {
    adapter,
    lock: () => () => {},
    changed: () => {},
  });
  const rows = (await workbench.handle('reviewList', scope)) as CodeReview[];
  expect(rows[0].status).toBe('unknown');
  expect(rows[0].text).toBe('partial');
  expect(adapter).not.toHaveBeenCalled();
  await workbench.close();
});
it('closing a running review settles its adapter and preserves unknown status', async () => {
  const { store, scope } = fixture();
  let finish = () => {};
  const adapter: AgentAdapter = {
    probe: async () => ({ models: [], modes: [] }),
    run: async () => {},
    review: async () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    respond: () => {},
    cancel: async () => finish(),
    close: async () => {},
  };
  const unlock = vi.fn();
  const workbench = new ReviewWorkbench(store, {
    adapter: async () => adapter,
    lock: () => unlock,
    changed: () => {},
  });
  const review = (await workbench.handle('reviewStart', {
    ...scope,
    target: { type: 'uncommittedChanges' },
    requestId: randomUUID(),
  })) as CodeReview;
  await workbench.close();
  expect(unlock).toHaveBeenCalledTimes(1);
  const row = store.sqlite
    .prepare('SELECT value FROM settings WHERE key=?')
    .get(`code-review:${review.id}`) as { value: string };
  expect(JSON.parse(row.value).status).toBe('unknown');
});
it('stages and commits in the selected worktree and rejects mismatched ownership', async () => {
  const { cwd, service, project, store } = fixture();
  const rootHead = git(cwd, 'rev-parse', 'HEAD');
  const isolated = (await service.handle('worktreeCreate', {
    projectId: project.id,
    provider: 'codex',
    ref: 'main',
    branch: 'review-isolated',
    requestId: randomUUID(),
  })) as import('../../shared/types').Session;
  const scope = { projectId: project.id, sessionId: isolated.id },
    path = store.directory(project.id, isolated.id);
  writeFileSync(join(path, 'isolated.txt'), 'isolated\n');
  await service.handle('gitStage', { ...scope, path: 'isolated.txt', staged: true });
  const preview = (await service.handle('gitCommitPreview', scope)) as CommitPreview;
  expect(preview.branch).toBe('review-isolated');
  await service.handle('gitCommit', {
    ...scope,
    preview: { head: preview.head, branch: preview.branch, fingerprint: preview.fingerprint },
    message: 'isolated commit',
    requestId: randomUUID(),
  });
  expect(git(cwd, 'rev-parse', 'HEAD')).toBe(rootHead);
  expect(git(path, 'show', 'HEAD:isolated.txt')).toBe('isolated');
  const another = store.addProject('/tmp');
  await expect(
    service.handle('gitCommitPreview', { ...scope, projectId: another.id }),
  ).rejects.toThrow();
});
it('rejects unsupported interactive review questions instead of silently waiting forever', async () => {
  const adapter = new CodexAdapter(resolve('tests/fixtures/agent.mjs'));
  const events: string[] = [];
  try {
    await adapter.review(
      {
        cwd: process.cwd(),
        session: { model: 'fixture', effort: '' },
        text: '',
        emit: (event: { text?: string }) => events.push(event.text || ''),
        nativeId: () => {},
      } as unknown as RunContext,
      { type: 'baseBranch', branch: 'needs-input' },
    );
    expect(events.join('')).toContain('Review continued');
  } finally {
    await adapter.close();
  }
});
it('does not start native review for a disabled provider', async () => {
  const { service, store, scope } = fixture();
  store.setSettings({ codexEnabled: false });
  await expect(
    service.handle('reviewStart', {
      ...scope,
      target: { type: 'uncommittedChanges' },
      requestId: randomUUID(),
    }),
  ).rejects.toThrow('disabled');
  expect(await service.handle('reviewList', scope)).toEqual([]);
});
