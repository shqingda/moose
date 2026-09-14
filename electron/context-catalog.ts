import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join, relative, basename, isAbsolute, sep } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import type { ContextEntry, PromptContext } from '../shared/types';
const ignored = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-electron',
  'release',
  '.next',
  'target',
  '.cache',
]);
/** 按连续字符和词边界给路径打分，返回负数表示不匹配。 */
export function fuzzyScore(query: string, value: string): number {
  const q = query.toLocaleLowerCase(),
    v = value.toLocaleLowerCase();
  if (!q) return 1;
  const exact = v.indexOf(q);
  if (exact >= 0) return 1000 - exact - (v.length - q.length) * 0.1;
  let at = 0,
    score = 0,
    previous = -2;
  for (const c of q) {
    const index = v.indexOf(c, at);
    if (index < 0) return -1;
    score += index === previous + 1 ? 12 : 2;
    if (index === 0 || '/-_ .'.includes(v[index - 1])) score += 8;
    at = index + 1;
    previous = index;
  }
  return score - v.length * 0.1;
}
const within = (root: string, path: string) => {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
};
export class ContextCatalog {
  private files = new Map<string, { at: number; value: Promise<ContextEntry[]> }>();
  constructor(private home = homedir()) {}
  /** 使用短时目录缓存进行模糊匹配，排序后只返回前 60 项。 */
  async search(root: string, query: string) {
    const cached = this.files.get(root);
    const value = cached && Date.now() - cached.at < 5000 ? cached.value : this.walk(root);
    if (!cached || value !== cached.value) this.files.set(root, { at: Date.now(), value });
    return (await value)
      .map((entry) => ({
        entry,
        score: Math.max(
          fuzzyScore(query, entry.path),
          fuzzyScore(query, entry.name) < 0 ? -1 : fuzzyScore(query, entry.name) + 5,
        ),
      }))
      .filter((e) => e.score >= 0)
      .sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path))
      .slice(0, 60)
      .map((e) => e.entry);
  }
  /** 限量、限深扫描项目文件，跳过构建目录和符号链接，避免遍历失控。 */
  private async walk(root: string) {
    const entries: ContextEntry[] = [],
      pending = [''];
    for (let index = 0; index < pending.length && entries.length < 25000; index++) {
      const directory = pending[index];
      let children;
      try {
        children = await readdir(join(root, directory), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const child of children) {
        if (ignored.has(child.name) || child.isSymbolicLink()) continue;
        const path = directory ? `${directory}/${child.name}` : child.name;
        if (!child.isDirectory() && !child.isFile()) continue;
        entries.push({
          id: path,
          name: child.name,
          path,
          kind: child.isDirectory() ? 'folder' : 'file',
          scope: 'project',
          description: directory,
        });
        if (child.isDirectory() && path.split('/').length < 16) pending.push(path);
        if (entries.length >= 25000) break;
      }
    }
    return entries;
  }
  /** 发现用户与项目技能目录，读取 SKILL.md 元数据，以真实路径去重。 */
  async skills(root: string): Promise<ContextEntry[]> {
    const bases: [string, 'global' | 'project'][] = [
      ...['.agents/skills', '.codex/skills', '.grok/skills'].map(
        (path) => [join(this.home, path), 'global'] as [string, 'global'],
      ),
      ...['.agents/skills', '.codex/skills', '.grok/skills'].map(
        (path) => [join(root, path), 'project'] as [string, 'project'],
      ),
    ];
    const results = new Map<string, ContextEntry>();
    for (const [base, scope] of bases) {
      const pending = [base];
      for (let i = 0; i < pending.length && i < 1000; i++) {
        const directory = pending[i];
        try {
          const path = await realpath(join(directory, 'SKILL.md'));
          if ((await stat(path)).size > 256 * 1024) continue;
          const source = await readFile(path, 'utf8'),
            front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] || '';
          const field = (name: string) =>
            new RegExp(`^${name}:\\s*(.*)$`, 'm')
              .exec(front)?.[1]
              ?.trim()
              .replace(/^['"]|['"]$/g, '') || '';
          const name = field('name') || basename(directory),
            description = field('description');
          results.set(path, {
            id: createHash('sha256').update(path).digest('hex'),
            name,
            path,
            kind: 'skill',
            scope,
            description: /^[>|]/.test(description)
              ? (front.match(/^description:.*\n((?:[ \t]+.*\n?)*)/m)?.[1] || '')
                  .replace(/\s+/g, ' ')
                  .trim()
              : description,
          });
        } catch {
          /* Not every directory contains a skill. */
        }
        if (relative(base, directory).split(sep).length >= 4) continue;
        try {
          for (const child of await readdir(directory, { withFileTypes: true }))
            if (
              (child.isDirectory() || (directory === base && child.isSymbolicLink())) &&
              !ignored.has(child.name)
            )
              pending.push(join(directory, child.name));
        } catch {
          /* Optional roots may not exist. */
        }
      }
    }
    return [...results.values()].sort(
      (a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name),
    );
  }
  /** 发送前重新解析引用和技能，校验真实文件路径仍位于项目边界内。 */
  async resolve(root: string, context?: PromptContext) {
    root = await realpath(root);
    const references: ContextEntry[] = [];
    for (const value of context?.references || []) {
      const path = await realpath(join(root, value));
      if (isAbsolute(value) || !within(root, path) || value.split('/').includes('.git'))
        throw new Error('Referenced file is outside the project');
      references.push({
        id: value,
        path,
        name: basename(path),
        kind: (await stat(path)).isDirectory() ? 'folder' : 'file',
        scope: 'project',
        description: '',
      });
    }
    const available = context?.skills.length ? await this.skills(root) : [];
    const skills = (context?.skills || []).map((id) => {
      const skill = available.find((s) => s.id === id);
      if (!skill) throw new Error('Selected skill is no longer available');
      return skill;
    });
    return { references, skills };
  }
}
