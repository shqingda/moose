// Produce a self-contained macOS arm64 release using the official Node archive.
import { cp, mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../..', import.meta.url));
const archive = resolve(process.argv[2] || '/tmp/moose-node-v24.21.0.tar.gz');
const nodeChecksum = 'bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('Build on macOS arm64');
if (hash(await readFile(archive)) !== nodeChecksum)
  throw new Error('Node archive checksum mismatch');
const stage = join(root, 'distribution/.build');
await rm(stage, { recursive: true, force: true });
const app = join(stage, 'app');
await mkdir(app, { recursive: true });
execFileSync('tar', ['-xzf', archive, '-C', stage]);
await mkdir(join(app, 'runtime/bin'), { recursive: true });
for (const file of ['bin/node', 'LICENSE']) {
  await cp(join(stage, 'node-v24.21.0-darwin-arm64', file), join(app, 'runtime', file));
}
for (const dir of ['dist', 'dist-electron/web-server', 'dist-electron/pty-host']) {
  await cp(join(root, dir), join(app, dir), {
    recursive: true,
    filter: (path) => !path.endsWith('.map'),
  });
}
await mkdir(join(app, 'scripts'));
await cp(join(root, 'scripts/runtime.mjs'), join(app, 'scripts/runtime.mjs'));
await mkdir(join(app, 'bin'));
await cp(join(root, 'distribution/scripts/moose'), join(app, 'bin/moose'));
await chmod(join(app, 'bin/moose'), 0o755);
const { version } = JSON.parse(await readFile(join(root, 'package.json')));
await writeFile(
  join(app, 'package.json'),
  JSON.stringify({ name: 'moose', version, type: 'module', private: true }),
);
// N-API modules and their runtime JS only: no pnpm links, source tree, or development tools.
for (const name of ['better-sqlite3', 'node-pty']) {
  const source = join(root, 'node_modules', name);
  const target = join(app, 'node_modules', name);
  await mkdir(target, { recursive: true });
  for (const file of ['package.json', 'LICENSE', 'lib']) {
    await cp(join(source, file), join(target, file), {
      recursive: true,
      dereference: true,
      filter: (path) => !path.endsWith('.map'),
    });
  }
  const native =
    name === 'better-sqlite3' ? 'prebuilds/darwin-arm64.node' : 'prebuilds/darwin-arm64';
  await cp(join(source, native), join(target, native), { recursive: true });
}
await chmod(join(app, 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper'), 0o755);
execFileSync('tar', ['-czf', join(stage, 'package.tar.gz'), '-C', app, '.']);
const bytes = await readFile(join(stage, 'package.tar.gz'));
const checksum = hash(bytes);
const release = `${version}-${checksum.slice(0, 12)}`;
const output = join(root, 'distribution/public');
const partsDir = join(output, 'releases', release, 'darwin-arm64');
await mkdir(partsDir, { recursive: true });
// Workers Static Assets has a 25 MiB per-file limit; each immutable part stays below it.
const size = 20 * 1024 * 1024;
const parts = Math.ceil(bytes.length / size);
for (let part = 0; part < parts; part++)
  await writeFile(join(partsDir, `part-${part}`), bytes.subarray(part * size, (part + 1) * size));
await writeFile(join(output, 'latest-darwin-arm64.txt'), `${release} ${checksum} ${parts}\n`);
await cp(join(root, 'distribution/install.sh'), join(output, 'install.sh'));
await writeFile(
  join(output, '_headers'),
  '/install.sh\n  Content-Type: text/plain; charset=utf-8\n  Cache-Control: no-cache\n/latest-darwin-arm64.txt\n  Cache-Control: no-cache\n/releases/*\n  Cache-Control: public, max-age=31536000, immutable\n  Content-Type: application/octet-stream\n',
);
console.log(`Packaged ${release}: ${(bytes.length / 1024 / 1024).toFixed(1)} MiB, ${parts} parts`);
