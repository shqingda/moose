import { spawn } from 'node:child_process';
import { accessSync, closeSync, fchmodSync, mkdirSync, openSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { SharedRuntime } from './shared-runtime';
import { startupMark } from './startup-marks';
import type { AppEvent } from '../shared/types';
import { version } from '../package.json';

/** Keep the existing desktop data directory; only change who owns the service process. */
export function desktopRuntime(entry: string, data: string, emit: (event: AppEvent) => void) {
  const file = join(data, 'connection.json');
  // The steps before spawn are synchronous so the service starts while Electron is still booting,
  // instead of waiting for the event loop to service each file operation.
  const prepare = async () => {
    try {
      accessSync(file);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
      accessSync(join(data, 'server.lock'));
      throw new Error(
        'The background service is starting or stopped unexpectedly. Check runtime.log before restarting it.',
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    mkdirSync(data, { recursive: true, mode: 0o700 });
    const log = openSync(join(data, 'runtime.log'), 'a', 0o600);
    fchmodSync(log, 0o600);
    let failure: Error | undefined;
    startupMark('moose/service/spawn');
    const child = spawn(process.execPath, [entry], {
      detached: true,
      stdio: ['ignore', log, log],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        MOOSE_WEB_DATA_DIR: data,
        MOOSE_WEB_PORT: '0',
        // The desktop's automatic service is strictly local.
        MOOSE_WEB_PUBLIC_ORIGIN: '',
        // Reuse V8 bytecode for the service bundle across starts; web-server drops it before spawning CLIs.
        NODE_COMPILE_CACHE: join(data, 'compile-cache'),
        MOOSE_COMPILE_CACHE: '1',
      },
    });
    child.on('error', (error) => {
      failure = error;
    });
    child.unref();
    closeSync(log);
    // A short poll: access() is cheap, and every interval is spent with the window waiting.
    for (let attempt = 0; attempt < 1200; attempt++) {
      if (failure) throw failure;
      try {
        await access(file);
        startupMark('moose/service/ready');
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (child.exitCode !== null)
        throw new Error('Background service exited. See ' + join(data, 'runtime.log'));
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Background service did not become ready. See ' + join(data, 'runtime.log'));
  };
  return new SharedRuntime(file, emit, prepare, version);
}
