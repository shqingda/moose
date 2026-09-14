import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, open, realpath, readlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { GitDiff, GitFile, GitStatus } from '../shared/types';
const execute = promisify(execFile);
const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_LITERAL_PATHSPECS: '1' };
/** 以参数数组执行 Git，设置超时及输出上限，不拼接 shell 命令。 */
async function git(cwd: string, args: string[]) {
  return (
    await execute('/usr/bin/git', ['-c', 'core.quotePath=false', ...args], {
      cwd,
      env,
      timeout: 12000,
      maxBuffer: 16 * 1024 * 1024,
    })
  ).stdout;
}
/** 解析 NUL 分隔状态，正确处理空格路径、重命名以及暂存区和工作区双重改动。 */
export function parseStatus(output: string): GitFile[] {
  const fields = output.split('\0'),
    files: GitFile[] = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (!entry) continue;
    const x = entry[0],
      y = entry[1],
      path = entry.slice(3);
    const oldPath = [x, y].some((s) => s === 'R' || s === 'C') ? fields[++i] : undefined;
    if (x === '?' && y === '?') files.push({ path, status: '?', area: 'untracked' });
    else {
      if (x !== ' ' && x !== '?') files.push({ path, oldPath, status: x, area: 'staged' });
      if (y !== ' ' && y !== '?') files.push({ path, oldPath, status: y, area: 'unstaged' });
    }
  }
  return files;
}
/** 读取当前分支与改动列表；非 Git 目录返回 isRepo=false。 */
export async function gitStatus(cwd: string): Promise<GitStatus> {
  try {
    await git(cwd, ['rev-parse', '--show-toplevel']);
  } catch {
    return { isRepo: false, branch: '', files: [] };
  }
  const [status, branch] = await Promise.all([
    git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    git(cwd, ['branch', '--show-current']),
  ]);
  return { isRepo: true, branch: branch.trim() || 'Detached HEAD', files: parseStatus(status) };
}
/** 判断路径是否位于根目录内，避免目录穿越。 */
export function inside(root: string, path: string) {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}
/** 验证改动仍存在后读取只读 diff；限制输出大小并处理二进制和未跟踪文件。 */
export async function gitDiff(cwd: string, path: string, area: GitFile['area']): Promise<GitDiff> {
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  const target = resolve(root, path);
  if (!inside(root, target) || path.split('/').includes('.git'))
    throw new Error('File is outside the project');
  const status = await gitStatus(cwd);
  if (!status.files.some((file) => file.path === path && file.area === area))
    throw new Error('The file changed. Refresh the changes list.');
  const limit = 256 * 1024;
  if (area === 'untracked') {
    const stat = await lstat(target);
    if (stat.isSymbolicLink())
      return { text: `Symbolic link → ${await readlink(target)}`, binary: false, truncated: false };
    if (!stat.isFile() || !inside(root, await realpath(target)))
      throw new Error('Cannot preview this file');
    const file = await open(target, 'r');
    try {
      const data = Buffer.alloc(Math.min(stat.size, limit));
      await file.read(data, 0, data.length, 0);
      const binary = data.includes(0);
      const lines = data.toString('utf8').replace(/\n$/, '').split('\n');
      return {
        text:
          binary || !data.length
            ? ''
            : `@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join('\n')}`,
        binary,
        truncated: stat.size > limit,
      };
    } finally {
      await file.close();
    }
  }
  return new Promise((resolveResult, reject) => {
    const p = spawn(
      '/usr/bin/git',
      [
        '--no-pager',
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--no-color',
        ...(area === 'staged' ? ['--cached'] : []),
        '--',
        path,
      ],
      { cwd: root, env },
    );
    let bytes = 0,
      text = '',
      truncated = false;
    const timeout = setTimeout(() => {
      p.kill();
      reject(new Error('Git diff timed out'));
    }, 12000);
    p.stdout.on('data', (chunk: Buffer) => {
      const available = Math.max(0, limit - bytes);
      text += chunk.subarray(0, available).toString('utf8');
      bytes += chunk.length;
      if (bytes > limit) {
        truncated = true;
        p.kill();
      }
    });
    p.stderr.resume();
    p.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    p.on('close', (code) => {
      clearTimeout(timeout);
      if (code && !truncated) reject(new Error('Unable to read Git diff'));
      else
        resolveResult({ text, binary: /^Binary files |^GIT binary patch/m.test(text), truncated });
    });
  });
}
