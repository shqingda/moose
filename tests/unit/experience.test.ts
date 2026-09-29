import { JsonRpc, type RpcMessage } from '../../electron/providers/rpc';
import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../../electron/db/store';
import { searchMessages, locateMessage, pendingMessage } from '../../electron/experience-data';
import { FilePreviews } from '../../electron/file-preview';
import { Attachments } from '../../electron/attachments';
import { Notices } from '../../electron/notices';
import { defaultSettings, type Message } from '../../shared/types';
import { MooseError, restoreError, fault, transportError } from '../../shared/errors';
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'moose-ux-'))),
    store = new Store(join(root, 'db.sqlite'));
  const project = store.addProject(root),
    session = store.createSession(project.id, 'codex');
  store.updateSession(session.id, { title: '中文项目测试', draft: 'SECRET_DRAFT', archived: true });
  cleanup.push(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { root, store, project, session };
}
function message(store: Store, sessionId: string, text: string, extra: Partial<Message> = {}) {
  return store.saveMessage({
    id: randomUUID(),
    sessionId,
    runId: 'run',
    seq: 1,
    kind: 'assistant',
    state: 'done',
    text,
    title: '',
    createdAt: 1,
    ...extra,
  });
}
it('searches Chinese and literal metacharacters across pages without leaking drafts or details', () => {
  const { store, session, project } = fixture();
  for (let i = 0; i < 125; i++) message(store, session.id, `中文命中 ${i}`);
  message(store, session.id, 'literal % _ \\ needle', {
    questions: [{ id: 'secret', text: 'SECRET_DETAIL', secret: true, options: [] }],
  });
  let page = searchMessages(store, { query: '中文命中', projectId: project.id });
  const ids = page.hits.map((h) => h.messageId);
  while (page.cursor) {
    page = searchMessages(store, { query: '中文命中', projectId: project.id, cursor: page.cursor });
    ids.push(...page.hits.map((h) => h.messageId));
  }
  expect(ids).toHaveLength(125);
  expect(new Set(ids).size).toBe(125);
  expect(page.hits.every((h) => h.archived)).toBe(true);
  expect(searchMessages(store, { query: '% _ \\' }).hits).toHaveLength(1);
  expect(searchMessages(store, { query: 'SECRET' }).hits).toHaveLength(0);
  expect(searchMessages(store, { query: '中文项目' }).hits[0].sessionId).toBe(session.id);
  expect(() => searchMessages(store, { query: 'test', cursor: '[1]' })).toThrow('cursor');
});
it('locates old messages without loading the whole history and rejects cross-session lookup', () => {
  const { store, session, project } = fixture();
  let target = '';
  for (let i = 0; i < 240; i++) {
    const m = message(store, session.id, `line ${i}`);
    if (i === 100) target = m.id;
  }
  const page = locateMessage(store, { sessionId: session.id, messageId: target });
  expect(page.messages).toHaveLength(160);
  expect(page.hasMore).toBe(true);
  expect(page.hasLater).toBe(true);
  expect(page.messages.some((m) => m.id === target)).toBe(true);
  expect(() =>
    locateMessage(store, {
      sessionId: store.createSession(project.id, 'codex').id,
      messageId: target,
    }),
  ).toThrow();
});
it('only exposes current actionable plans and pending questions', () => {
  const { store, session } = fixture();
  message(store, session.id, 'go', { kind: 'user' });
  const plan = message(store, session.id, 'plan', { kind: 'plan', plan: { version: 1 } });
  expect(pendingMessage(store, session.id)?.id).toBe(plan.id);
  message(store, session.id, 'new', { kind: 'user', runId: 'new' });
  expect(pendingMessage(store, session.id)).toBeUndefined();
  const approval = message(store, session.id, 'allow', { kind: 'approval', state: 'pending' });
  expect(pendingMessage(store, session.id)?.id).toBe(approval.id);
});
it('coordinates notifications across clients and suppresses focused sessions, duplicates and stale presence', () => {
  let now = 0;
  const notices = new Notices(() => now);
  const settings = { ...defaultSettings, notifyAttention: true, notifyResults: true };
  const notice = { id: 'e', sessionId: 's', kind: 'attention' as const, project: 'p', title: 't' };
  notices.presence('a', { sessionId: 's', focused: true });
  notices.presence('b', { focused: false });
  expect(notices.add(notice)).toBe(true);
  expect(notices.add(notice)).toBe(false);
  expect(notices.claim('e', 'b', settings)).toBeNull();
  notices.presence('a', { focused: false });
  expect(notices.claim('e', 'b', settings)).toBeNull();
  notices.add({ ...notice, id: 'next' });
  expect(notices.claim('next', 'a', settings)?.id).toBe('next');
  expect(notices.claim('next', 'b', settings)).toBeNull();
  notices.add({ ...notice, id: 'disabled' });
  expect(notices.claim('disabled', 'a', defaultSettings)).toBeNull();
  now = 46000;
  expect(notices.claim('disabled', 'a', settings)).toBeNull();
  notices.presence('a', { focused: false });
  expect(notices.claim('disabled', 'a', settings)).not.toBeNull();
});
it('previews bounded UTF-8 and images, offers binary downloads, and denies path/symlink escapes', async () => {
  const { root, store, project } = fixture();
  const files = new FilePreviews(store, new Attachments(store.sqlite.name));
  const ref = (path: string) => ({ projectId: project.id, path });
  writeFileSync(join(root, 'code.ts'), 'const a = 1;');
  expect(await files.preview(ref('code.ts'))).toMatchObject({
    kind: 'text',
    content: 'const a = 1;',
    truncated: false,
  });
  writeFileSync(join(root, 'large.txt'), '中'.repeat(400000));
  expect(await files.preview(ref('large.txt'))).toMatchObject({ kind: 'text', truncated: true });
  writeFileSync(join(root, 'a.pdf'), '%PDF-binary');
  expect(await files.preview(ref('a.pdf'))).toMatchObject({ kind: 'download' });
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=',
    'base64',
  );
  writeFileSync(join(root, 'x.png'), png);
  expect(await files.preview(ref('x.png'))).toMatchObject({ kind: 'image' });
  await expect(files.preview(ref('../outside'))).rejects.toMatchObject({ code: 'file-access' });
  await expect(files.preview(ref('missing'))).rejects.toMatchObject({ code: 'missing-file' });
  symlinkSync(join(root, 'code.ts'), join(root, 'inside.ts'));
  expect(await files.preview(ref('inside.ts'))).toMatchObject({ kind: 'text' });
  symlinkSync('/etc', join(root, 'escape'));
  await expect(files.preview(ref('escape/hosts'))).rejects.toMatchObject({ code: 'file-access' });
  mkdirSync(join(root, 'worktree'));
  store.saveWorktree({
    id: 'wt',
    projectId: project.id,
    path: join(root, 'worktree'),
    status: 'ready',
  } as Parameters<Store['saveWorktree']>[0]);
  const session = store.createSession(project.id, 'codex');
  store.updateSession(session.id, { worktreeId: 'wt' });
  await expect(
    files.preview({ projectId: project.id, sessionId: session.id, path: '../code.ts' }),
  ).rejects.toMatchObject({ code: 'file-access' });
  const attachment = await new Attachments(store.sqlite.name).import(
    'readme.txt',
    Buffer.from('attachment'),
  );
  expect(await files.preview({ attachmentId: attachment.id })).toMatchObject({
    content: 'attachment',
  });
});
it('lists one workspace directory at a time and enforces worktree and symlink boundaries', async () => {
  const { root, store, project, session } = fixture();
  const files = new FilePreviews(store, new Attachments(store.sqlite.name));
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, '.git'));
  writeFileSync(join(root, 'src', 'hello.ts'), 'export const hello = 1;');
  writeFileSync(join(root, 'z.txt'), 'root');
  symlinkSync('/etc', join(root, 'outside'));
  const listing = await files.list({ projectId: project.id, path: '.' });
  expect(listing.entries[0]).toMatchObject({ name: 'src', kind: 'directory' });
  expect(
    listing.entries.some((entry) => ['.git', 'outside', 'hello.ts'].includes(entry.name)),
  ).toBe(false);
  expect(await files.list({ projectId: project.id, path: 'src' })).toEqual({
    entries: [{ name: 'hello.ts', path: 'src/hello.ts', kind: 'file' }],
    truncated: false,
  });
  await expect(files.list({ projectId: project.id, path: '..' })).rejects.toMatchObject({
    code: 'file-access',
  });
  await expect(files.list({ projectId: project.id, path: 'outside' })).rejects.toMatchObject({
    code: 'file-access',
  });
  await expect(files.list({ projectId: project.id, path: 'missing' })).rejects.toMatchObject({
    code: 'missing-file',
  });
  store.saveWorktree({
    id: 'tree',
    projectId: project.id,
    path: join(root, 'src'),
    status: 'ready',
  } as Parameters<Store['saveWorktree']>[0]);
  store.updateSession(session.id, { worktreeId: 'tree' });
  expect(
    (await files.list({ projectId: project.id, sessionId: session.id, path: '.' })).entries,
  ).toEqual([{ name: 'hello.ts', path: 'hello.ts', kind: 'file' }]);
  await expect(
    files.list({ projectId: project.id, sessionId: session.id, path: '..' }),
  ).rejects.toMatchObject({ code: 'file-access' });
});
it('retains typed faults and never labels an unknown write result as safe to retry', () => {
  expect(restoreError(fault(new MooseError('version', 'detail')))).toMatchObject({
    code: 'version',
    message: 'detail',
  });
  expect(restoreError('legacy')).toMatchObject({ code: 'unknown', message: 'legacy' });
  expect(transportError('send', new Error('lost')).code).toBe('uncertain');
  expect(transportError('snapshot', 'lost').code).toBe('disconnected');
});
it('searches 10,000 one-KiB messages under the 300 ms P95 budget', () => {
  const { store, session } = fixture();
  store.sqlite.transaction(() => {
    for (let i = 0; i < 10000; i++)
      message(store, session.id, `${i} ${'x'.repeat(1024)} 性能needle`);
  })();
  const timings = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    searchMessages(store, { query: i % 2 ? '性能needle' : 'not present' });
    timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  console.log(`Search 10k P95: ${timings[18].toFixed(1)} ms`);
  expect(timings[18]).toBeLessThan(300);
});

it('recognizes explicit ACP authentication errors without guessing from generic RPC codes or text', async () => {
  for (const acp of [false, true]) {
    const rpc = new JsonRpc(
      process.execPath,
      [
        '-e',
        `process.stdin.on('data', data => { const request=JSON.parse(data); process.stdout.write(JSON.stringify({id: request.id, error:{code:-32000,message:'login failed'}})+'\\n'); });`,
      ],
      undefined,
      {
        authenticationErrorCode: acp ? -32000 : undefined,
        encode: (value) => value,
        decode: (value) => value as RpcMessage,
      },
    );
    try {
      await expect(rpc.request('initialize', {})).rejects.toMatchObject({
        code: acp ? 'auth' : 'unknown',
      });
    } finally {
      await rpc.close();
    }
  }
});
