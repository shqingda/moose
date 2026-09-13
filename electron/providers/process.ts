import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import type { Provider } from '../../shared/types';
const children = new Set<ChildProcessWithoutNullStreams>();
process.once('exit', () => { for (const child of children) { try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* Already exited. */ } } });

export const agentEnvironment = () => ({ ...process.env, PATH: [...new Set([...(process.env.PATH || '').split(delimiter), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', join(homedir(), '.local/bin'), join(homedir(), '.grok/bin'), join(homedir(), '.cargo/bin')])].join(delimiter) });
export async function discover(provider: Provider, configured: string): Promise<string> {
  const candidates = configured ? [configured] : [
    ...agentEnvironment().PATH.split(delimiter).map(dir => join(dir, provider)),
  ];
  for (const path of candidates) { if (!isAbsolute(path)) continue; try { await access(path, constants.X_OK); return path; } catch { /* Try next executable. */ } }
  throw new Error(configured ? `Executable is unavailable: ${configured}` : `${provider} CLI was not found. Install it or select its absolute path in Settings.`);
}
export function spawnAgent(path: string, args: string[], cwd?: string): ChildProcessWithoutNullStreams {
  const child = spawn(path, args, { cwd, env: agentEnvironment(), stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  children.add(child); child.once('exit', () => children.delete(child)); child.once('error', () => children.delete(child)); return child;
}
export async function terminate(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  const signal = (name: NodeJS.Signals) => { try { if (process.platform === 'win32') child.kill(name); else process.kill(-child.pid!, name); } catch { /* Already exited. */ } };
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => { signal('SIGKILL'); resolve(); }, 2000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    signal('SIGTERM');
  });
}
export async function cliVersion(path: string) {
  const p = spawnAgent(path, ['--version']);
  let output = '';
  p.stdout.on('data', chunk => { output = (output + chunk).slice(0, 1000); });
  const result = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { void terminate(p); reject(new Error('CLI version check timed out')); }, 8000);
    p.once('error', error => { clearTimeout(timer); reject(error); });
    p.once('exit', code => { clearTimeout(timer); if (code === 0) resolve(output.trim()); else reject(new Error(`CLI exited with code ${code}`)); });
  });
  return result;
}
