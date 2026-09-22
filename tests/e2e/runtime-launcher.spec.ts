import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const exec = promisify(execFile);
test('managed runtime starts once, survives launcher exit, stops and restarts with new credentials', async () => {
  const data = await mkdtemp(join(tmpdir(), 'moose-launcher-'));
  const env = { ...process.env, MOOSE_WEB_DATA_DIR: data, MOOSE_WEB_PORT: '0' };
  const run = (command: string) =>
    exec(process.execPath, [resolve('scripts/runtime.mjs'), command], { env, timeout: 20000 });
  try {
    await run('start');
    const file = join(data, 'connection.json');
    const first = JSON.parse(await readFile(file, 'utf8'));
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const pid = await readFile(join(data, 'server.lock'), 'utf8');
    await run('start');
    expect(await readFile(join(data, 'server.lock'), 'utf8')).toBe(pid);
    expect((await run('status')).stdout).toContain(first.origin);
    await writeFile(file, JSON.stringify({ ...first, version: '0.0.0' }));
    await expect(run('start')).rejects.toThrow('moose stop');
    expect((await run('status')).stdout).toContain(first.origin);
    await run('stop');
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    await run('start');
    const second = JSON.parse(await readFile(file, 'utf8'));
    expect(second.token).not.toBe(first.token);
    expect((await run('status')).stdout).toContain(second.origin);
  } finally {
    await run('stop').catch(() => {});
    await rm(data, { recursive: true, force: true });
  }
});
