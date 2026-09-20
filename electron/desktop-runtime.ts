import { spawn } from 'node:child_process';
import { access, mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { SharedRuntime } from './shared-runtime';
import type { AppEvent } from '../shared/types';
import { version } from '../package.json';

/** Keep the existing desktop data directory; only change who owns the service process. */
export function desktopRuntime(entry: string, data: string, emit: (event: AppEvent) => void) {
  const file = join(data, 'connection.json');
  const prepare = async () => {
    try {
      await access(file);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
      await access(join(data, 'server.lock'));
      throw new Error(
        'The background service is starting or stopped unexpectedly. Check runtime.log before restarting it.',
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await mkdir(data, { recursive: true, mode: 0o700 });
    const log = await open(join(data, 'runtime.log'), 'a', 0o600);
    await log.chmod(0o600);
    let failure: Error | undefined;
    const child = spawn(process.execPath, [entry], {
      detached: true,
      stdio: ['ignore', log.fd, log.fd],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        MOOSE_WEB_DATA_DIR: data,
        MOOSE_WEB_PORT: '0',
        // The desktop's automatic service is strictly local.
        MOOSE_WEB_PUBLIC_ORIGIN: '',
      },
    });
    child.on('error', (error) => {
      failure = error;
    });
    child.unref();
    await log.close();
    for (let attempt = 0; attempt < 60; attempt++) {
      if (failure) throw failure;
      try {
        await access(file);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (child.exitCode !== null)
        throw new Error('Background service exited. See ' + join(data, 'runtime.log'));
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('Background service did not become ready. See ' + join(data, 'runtime.log'));
  };
  return new SharedRuntime(file, emit, prepare, version);
}
