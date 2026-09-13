import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContextCatalog } from '../../electron/context-catalog';
it('finds fuzzy files and folders, excludes generated trees and rejects escaping references', async () => {
 const root = await mkdtemp(join(tmpdir(), 'moose-context-'));
 try {
  await mkdir(join(root, '中文 project')); await writeFile(join(root, '中文 project', 'Application.tsx'), '');
  await mkdir(join(root, 'node_modules')); await writeFile(join(root, 'node_modules', 'secret.ts'), '');
  await symlink(tmpdir(), join(root, 'outside'));
  const catalog = new ContextCatalog(root);
  expect((await catalog.search(root, 'aptsx')).map(e => e.name)).toContain('Application.tsx');
  expect((await catalog.search(root, '中文')).some(e => e.kind === 'folder')).toBe(true);
  expect(await catalog.search(root, 'nonexistentzzzz')).toEqual([]);
  expect((await catalog.search(root, '')).some(e => e.path.includes('node_modules'))).toBe(false);
  await expect(catalog.resolve(root, { mode: 'build', skills: [], references: ['outside'] })).rejects.toThrow('outside');
 } finally { await rm(root, { recursive: true, force: true }); }
});
it('discovers project and global skills and resolves only catalogued IDs', async () => {
 const root = await mkdtemp(join(tmpdir(), 'moose-skills-'));
 try {
  const project = join(root, 'project');
  for (const base of [root, project]) { const skill = join(base, '.agents/skills/design'); await mkdir(skill, { recursive: true }); await writeFile(join(skill, 'SKILL.md'), '---\nname: design\ndescription: Design thoughtfully\n---\nInstructions'); }
  const catalog = new ContextCatalog(root), entries = await catalog.skills(project);
  expect(entries.map(e => e.scope)).toEqual(['global', 'project']);
  expect((await catalog.resolve(project, { mode: 'plan', references: [], skills: [entries[1].id] })).skills[0].path).toContain('/project/');
  await expect(catalog.resolve(project, { mode: 'build', references: [], skills: ['unknown'] })).rejects.toThrow('no longer available');
 } finally { await rm(root, { recursive: true, force: true }); }
});

it('waits for a native goal continuation instead of finishing at the first turn', async () => {
 const { CodexAdapter } = await import('../../electron/providers/codex');
 const { resolve } = await import('node:path');
 const { chmod } = await import('node:fs/promises');
 const { randomUUID } = await import('node:crypto');
 const root = await mkdtemp(join(tmpdir(), 'moose-goal-')), path = resolve('tests/fixtures/agent.mjs'); await chmod(path, 0o755);
 const adapter = new CodexAdapter(path); let text = '';
 try {
  await adapter.run({ cwd: root, text: 'inspect-input', session: { id: randomUUID(), projectId: randomUUID(), title: '', provider: 'codex', nativeId: null, status: 'idle', archived: false, model: '', effort: '', mode: 'ask', draft: '', createdAt: 0, updatedAt: 0 }, promptContext: { mode: 'goal', references: [], skills: [] }, nativeId() {}, emit(event) { if (event.kind === 'assistant') text += event.text || event.delta || ''; } });
  expect(text).toContain('Goal complete after continuation.');
 } finally { await adapter.close(); await rm(root, { recursive: true, force: true }); }
});

it('removing ordinary inline reference text removes its structured context', async () => {
 const { contextInText, referenceText } = await import('../../shared/prompt-context');
 const context = { mode: 'build' as const, references: ['src/中文 file.ts', 'README.md'], skills: ['design'] };
 const skills = [{ id: 'design', name: 'apple-design' }];
 expect(referenceText('@', 'README.md')).toBe('@README.md');
 const selected = contextInText('@"src/中文 file.ts" /apple-design', context, skills);
 expect(selected.references).toEqual(['src/中文 file.ts']); expect(selected.skills).toEqual(['design']);
 expect(contextInText('ordinary text', selected, skills)).toMatchObject({ references: [], skills: [] });
});
