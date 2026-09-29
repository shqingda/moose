// Update only the installed files. The running service keeps its current release and tasks.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
const exec = promisify(execFile);
export async function update(root) {
  if (process.env.MOOSE_NODE_RUNTIME !== '1' || basename(dirname(root)) !== 'releases')
    throw new Error(
      'moose update is available in standalone Web installations. Use the Web installer first.',
    );
  const install = dirname(dirname(root));
  const config = JSON.parse(await readFile(join(install, 'install.json'), 'utf8'));
  if (typeof config.binDir !== 'string' || typeof config.base !== 'string')
    throw new Error('Installation settings are missing. Re-run the Web installer.');
  console.log('Checking and installing the latest Moose Web release…');
  await exec('/bin/sh', [join(root, 'scripts/install.sh')], {
    env: {
      ...process.env,
      MOOSE_INSTALL_DIR: install,
      MOOSE_BIN_DIR: config.binDir,
      MOOSE_DOWNLOAD_BASE: process.env.MOOSE_DOWNLOAD_BASE || config.base,
      MOOSE_NO_MODIFY_PATH: '1',
    },
    timeout: 180000,
  });
  const current = await realpath(join(install, 'current'));
  const { version } = JSON.parse(await readFile(join(current, 'package.json'), 'utf8'));
  console.log(`Moose ${version} is installed. Running tasks have not been interrupted.`);
  console.log('After your tasks finish, run: moose stop && moose');
}
