import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  PiSessions,
  parsePiHistory,
  piSessionDirectory,
} from '../../electron/providers/pi-sessions';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const text = (cwd: string) =>
  [
    { type: 'session', id: 'native', version: 3, cwd },
    { type: 'model_change', id: 'model', parentId: null, provider: 'test', modelId: 'model' },
    {
      type: 'message',
      id: 'user',
      parentId: 'model',
      message: { role: 'user', content: 'Original request' },
    },
    {
      type: 'message',
      id: 'abandoned',
      parentId: 'user',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Abandoned answer' }] },
    },
    {
      type: 'branch_summary',
      id: 'branch',
      parentId: 'user',
      fromId: 'abandoned',
      summary: 'Previous exploration',
    },
    {
      type: 'message',
      id: 'kept',
      parentId: 'branch',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Retained answer' }] },
    },
    {
      type: 'compaction',
      id: 'compact',
      parentId: 'kept',
      summary: 'Compressed context',
      firstKeptEntryId: 'kept',
    },
    { type: 'context_edit', id: 'edit', parentId: 'compact', targetId: 'kept', replacement: null },
    { type: 'session_info', id: 'name', parentId: 'edit', name: 'Native title' },
  ]
    .map((entry) => JSON.stringify(entry))
    .join('\n') + '\n';
async function fixture() {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'moose-pi-history-')));
  roots.push(cwd);
  const agent = join(cwd, 'agent'),
    directory = piSessionDirectory(cwd, agent);
  await mkdir(directory, { recursive: true });
  const id = join(directory, '2026-10-02_native.jsonl');
  await writeFile(id, text(cwd));
  return { cwd, directory, id, native: new PiSessions(agent) };
}
it('projects the active branch and compaction while preserving raw context edits', () => {
  const result = parsePiHistory(text('/tmp'));
  expect(result.title).toBe('Native title');
  expect(result.model).toBe('test/model');
  expect(result.items.map((item) => item.text)).toEqual([
    'Compressed context',
    'Retained answer',
    'Future context changed for entry kept. Original history is preserved.',
  ]);
});
it('browses without modifying the file and rejects arbitrary paths, symlinks and foreign cwd', async () => {
  const { cwd, directory, id, native } = await fixture();
  const before = await readFile(id, 'utf8');
  expect((await native.list(cwd)).data[0]).toMatchObject({ id, title: 'Native title' });
  expect((await native.items(id, cwd)).data).toHaveLength(3);
  expect(await readFile(id, 'utf8')).toBe(before);
  await expect(native.read(join(cwd, 'outside.jsonl'), cwd)).rejects.toThrow('outside');
  const link = join(directory, 'link.jsonl');
  await symlink(id, link);
  await expect(native.read(link, cwd)).rejects.toThrow();
  const foreign = join(directory, 'foreign.jsonl');
  await writeFile(foreign, text(tmpdir()));
  await expect(native.read(foreign, cwd)).rejects.toThrow('different project');
});
it('keeps corrupt history visible but refuses a partial import', async () => {
  const { cwd, directory, native } = await fixture();
  const id = join(directory, 'z-broken.jsonl');
  await writeFile(id, text(cwd) + '{');
  expect((await native.list(cwd)).data[0]).toMatchObject({ id, status: 'error' });
  await expect(native.items(id, cwd)).rejects.toThrow('invalid JSON');
  expect(() =>
    parsePiHistory(text(cwd).replace('"parentId":"kept"', '"parentId":"missing"')),
  ).toThrow('invalid branch');
  expect(() => parsePiHistory(text(cwd).replace('"version":3', '"version":9'))).toThrow(
    'unsupported',
  );
});
it('detects changes across preview pages instead of shifting entries silently', async () => {
  const { cwd, directory, id } = await fixture();
  const rows = [
    { type: 'session', id: 'long', cwd, version: 3 },
    ...Array.from({ length: 42 }, (_, i) => ({
      type: 'message',
      id: String(i),
      parentId: i ? String(i - 1) : null,
      message: { role: 'user', content: `Entry ${i}` },
    })),
  ];
  await writeFile(id, rows.map((row) => JSON.stringify(row)).join('\n'));
  const a = new PiSessions(join(cwd, 'agent'));
  const first = await a.items(id, cwd);
  expect(first.data).toHaveLength(40);
  expect((await a.items(id, cwd, first.nextCursor!)).data).toHaveLength(2);
  await writeFile(
    id,
    (await readFile(id, 'utf8')) +
      '\n' +
      JSON.stringify({
        type: 'message',
        id: 'new',
        parentId: '41',
        message: { role: 'user', content: 'new' },
      }),
  );
  await expect(
    new PiSessions(join(cwd, 'agent')).items(id, cwd, first.nextCursor!),
  ).rejects.toThrow('changed');
  expect(directory).toContain('--');
});

it('rejects a project session directory symlink that escapes the configured history root', async () => {
  const { cwd, directory } = await fixture();
  const outside = join(cwd, 'outside-history');
  await mkdir(outside);
  await writeFile(join(outside, 'history.jsonl'), text(cwd));
  await rm(directory, { recursive: true });
  await symlink(outside, directory);
  await expect(new PiSessions(join(cwd, 'agent')).list(cwd)).rejects.toThrow(
    'outside the configured',
  );
});
