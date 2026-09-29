import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
if (process.platform === 'darwin') {
  const { devDependencies } = JSON.parse(readFileSync('package.json', 'utf8'));
  const headers = [
    join(homedir(), '.electron-gyp', devDependencies.electron, 'include/node'),
    resolve(dirname(process.execPath), '../include/node'),
    join(homedir(), '.cache/node-gyp', process.versions.node, 'include/node'),
  ].find((path) => existsSync(join(path, 'node_api.h')));
  if (!headers)
    throw new Error('Node-API headers missing. Run pnpm native:rebuild before building.');
  const source = 'native/notification-permission.mm',
    target = 'dist-native/notifications.node';
  mkdirSync('dist-native', { recursive: true });
  if (
    !existsSync(target) ||
    statSync(target).mtimeMs <
      Math.max(statSync(source).mtimeMs, statSync('scripts/build-notifications.mjs').mtimeMs)
  ) {
    execFileSync(
      'xcrun',
      [
        'clang++',
        '-std=c++17',
        '-fobjc-arc',
        '-fblocks',
        '-dynamiclib',
        '-undefined',
        'dynamic_lookup',
        '-mmacosx-version-min=12.0',
        '-I',
        headers,
        '-framework',
        'Foundation',
        '-framework',
        'UserNotifications',
        source,
        '-o',
        target,
      ],
      { stdio: 'inherit' },
    );
  }
}
