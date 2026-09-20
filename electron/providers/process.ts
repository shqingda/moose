import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import type { Provider } from '../../shared/types';
const children = new Set<ChildProcessWithoutNullStreams>();
process.once('exit', () => {
  for (const child of children) {
    try {
      if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch {
      /* Already exited. */
    }
  }
});

let shellPath = '';
let shellPathRequest: Promise<void> | undefined;
let shellPathCheckedAt = 0;

/** 只读取 PATH；标记分隔 shell 欢迎输出，超时后回退并回收整个进程组。 */
export async function readShellPath(shell: string, timeout = 3000): Promise<string> {
  if (!isAbsolute(shell)) return '';
  const marker = `MOOSE_PATH_${randomUUID().replaceAll('-', '')}`;
  // 探测输入不能包含上次的 shellPath，否则刷新会保留已从配置删除的目录。
  const child = spawnAgent(
    shell,
    ['-ilc', `printf '\n${marker}%s${marker}\n' "$PATH"`],
    homedir(),
    process.env,
  );
  return new Promise((resolve) => {
    let output = '',
      settled = false;
    const finish = (value = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      finish();
      void terminate(child);
    }, timeout);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      if (output.length > 65536) {
        finish();
        void terminate(child);
      }
    });
    child.stderr.resume();
    child.on('error', () => finish());
    child.on('exit', (code) => {
      const start = output.indexOf(marker),
        end = output.indexOf(marker, start + marker.length);
      finish(
        code === 0 && start >= 0 && end > start ? output.slice(start + marker.length, end) : '',
      );
    });
  });
}

/** 并发探测共用一次 shell 查询；短期缓存避免每个代理重复启动登录 shell。 */
async function loadShellPath() {
  if (shellPathRequest) return shellPathRequest;
  if (Date.now() - shellPathCheckedAt < 30000) return;
  shellPathRequest = readShellPath(process.env.SHELL || userInfo().shell || '/bin/zsh')
    .then((path) => {
      shellPath = path;
      shellPathCheckedAt = Date.now();
    })
    .finally(() => {
      shellPathRequest = undefined;
    });
  return shellPathRequest;
}

/** 终端 PATH 优先，显式包管理器目录及常用安装位置作为补充；子进程复用相同环境。 */
export const agentEnvironment = () => ({
  ...process.env,
  PATH: [
    ...new Set([
      ...(process.env.PATH || '').split(delimiter),
      ...(process.env.PNPM_HOME ? [process.env.PNPM_HOME, join(process.env.PNPM_HOME, 'bin')] : []),
      ...shellPath.split(delimiter),
      ...(process.env.BUN_INSTALL ? [join(process.env.BUN_INSTALL, 'bin')] : []),
      ...(process.env.VOLTA_HOME ? [join(process.env.VOLTA_HOME, 'bin')] : []),
      join(homedir(), '.bun/bin'),
      join(homedir(), '.volta/bin'),
      join(homedir(), '.npm-global/bin'),
      join(homedir(), '.local/share/pnpm'),
      join(homedir(), 'Library/pnpm/bin'),
      join(homedir(), 'Library/pnpm'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      join(homedir(), '.local/bin'),
      join(homedir(), '.grok/bin'),
      join(homedir(), '.opencode/bin'),
      join(homedir(), '.cargo/bin'),
    ]),
  ]
    .filter(isAbsolute)
    .join(delimiter),
});
/** 优先使用配置路径，否则逐个搜索可执行 CLI；找不到时返回可诊断错误。 */
export async function discover(provider: Provider | 'gh', configured: string): Promise<string> {
  await loadShellPath();
  const candidates = configured
    ? [configured]
    : agentEnvironment()
        .PATH.split(delimiter)
        .map((dir) => join(dir, provider));
  for (const path of candidates) {
    if (!isAbsolute(path)) continue;
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      /* Try next executable. */
    }
  }
  throw new Error(
    configured
      ? `Executable is unavailable: ${configured}`
      : `${provider} CLI was not found. Install it or select its absolute path in Settings.`,
  );
}
/** 默认使用代理环境；环境探测可传入原始环境，所有进程统一登记退出清理。 */
export function spawnAgent(
  path: string,
  args: string[],
  cwd?: string,
  env: NodeJS.ProcessEnv = agentEnvironment(),
  watchParent = false,
): ChildProcessWithoutNullStreams {
  const child = spawn(path, args, {
    cwd,
    env,
    stdio: watchParent ? ['pipe', 'pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  child.once('error', () => children.delete(child));
  return child;
}
/** 先请求进程组正常退出，超时再强制终止，尽量避免遗留子进程。 */
export async function terminate(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  const signal = (name: NodeJS.Signals) => {
    try {
      if (process.platform === 'win32') child.kill(name);
      else process.kill(-child.pid!, name);
    } catch {
      /* Already exited. */
    }
  };
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal('SIGKILL');
      resolve();
    }, 2000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    signal('SIGTERM');
  });
}
/** 调用 CLI 的版本命令，供设置页展示与连接诊断。 */
export async function cliVersion(path: string) {
  const p = spawnAgent(path, ['--version']);
  let output = '';
  p.stdout.on('data', (chunk) => {
    output = (output + chunk).slice(0, 1000);
  });
  const result = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      void terminate(p);
      reject(new Error('CLI version check timed out'));
    }, 8000);
    p.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    p.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output.trim());
      else reject(new Error(`CLI exited with code ${code}`));
    });
  });
  return result;
}
