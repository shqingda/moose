import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentEnvironment, discover } from '../../electron/providers/process';

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it('replaces the cached shell PATH without inheriting obsolete directories', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moose-shell-refresh-'));
  dirs.push(dir);
  const shell = join(dir, 'shell');
  vi.stubEnv('SHELL', shell);
  vi.stubEnv('PATH', '/usr/bin:/bin');
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 31000);
  await writeFile(shell, '#!/bin/sh\nexport PATH="/obsolete-agent/bin:$PATH"\neval "$2"\n', {
    mode: 0o755,
  });
  await discover('pi', '/bin/sh');
  expect(agentEnvironment().PATH.split(':')).toContain('/obsolete-agent/bin');

  await writeFile(shell, '#!/bin/sh\nexport PATH="/replacement-agent/bin:$PATH"\neval "$2"\n');
  clock.mockReturnValue(now + 62000);
  await discover('pi', '/bin/sh');
  const paths = agentEnvironment().PATH.split(':');
  expect(paths).toContain('/replacement-agent/bin');
  expect(paths).not.toContain('/obsolete-agent/bin');
});

it.each(['', 'bin'])('discovers pnpm CLI in PNPM_HOME/%s without shell PATH', async (layout) => {
  const home = await mkdtemp(join(tmpdir(), 'moose-pnpm-'));
  dirs.push(home);
  const bin = join(home, layout);
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'pi'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  vi.stubEnv('PNPM_HOME', home);
  vi.stubEnv('PATH', '/usr/bin:/bin');
  expect(await discover('pi', '')).toBe(join(bin, 'pi'));
  expect(agentEnvironment().PATH.split(':')).toContain(bin);
});

it('reads a custom login PATH despite shell startup output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moose-shell-'));
  dirs.push(dir);
  const shell = join(dir, 'shell');
  await writeFile(
    shell,
    '#!/bin/sh\nprintf "startup banner\\n"\nexport PATH="/custom tools/bin:/usr/bin"\neval "$2"\n',
    { mode: 0o755 },
  );
  const { readShellPath } = await import('../../electron/providers/process');
  expect(await readShellPath(shell)).toBe('/custom tools/bin:/usr/bin');
});

it('falls back when the login shell is missing or hangs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moose-shell-'));
  dirs.push(dir);
  const shell = join(dir, 'shell');
  await writeFile(shell, '#!/bin/sh\n/bin/sleep 10\n', { mode: 0o755 });
  const { readShellPath } = await import('../../electron/providers/process');
  expect(await readShellPath(join(dir, 'missing'))).toBe('');
  expect(await readShellPath(shell, 50)).toBe('');
});
