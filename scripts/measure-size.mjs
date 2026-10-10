// Same definition for every release: raw bytes, gzip bytes, static entry graph and lazy resources.
import { open, readFile, readdir, stat } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
const root = resolve(process.argv[2] || '.');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
async function files(directory) {
  const rows = await Promise.all(
    (await readdir(directory, { withFileTypes: true })).map(async (item) => {
      const path = join(directory, item.name);
      if (item.isDirectory()) return files(path);
      if (!item.isFile()) return [];
      return [{ path: relative(root, path), bytes: (await stat(path)).size }];
    }),
  );
  return rows.flat();
}
const assets = await files(join(root, 'dist'));
const html = await readFile(join(root, 'dist/index.html'), 'utf8');
const entryPaths = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"\s]+\.js)"/g)].map(
  (match) => 'dist/' + match[1],
);
const visited = new Set();
async function visit(path) {
  if (visited.has(path)) return;
  visited.add(path);
  const code = await readFile(join(root, path), 'utf8');
  // Static import/export statements only. Dynamic import() belongs to a lazy feature.
  const imports = [
    ...code.matchAll(
      /(?:\bimport\s*(?:[^;]*?\bfrom\s*)?|\bexport\s*[^;]*?\bfrom\s*)["'](\.\.?\/[^"']+)["']/g,
    ),
  ];
  for (const [, specifier] of imports)
    if (specifier.endsWith('.js'))
      await visit(relative(root, resolve(root, path, '..', specifier)));
}
for (const path of entryPaths) await visit(path);
const entry = assets.filter((file) => visited.has(file.path));
async function gzipBytes(rows) {
  let bytes = 0;
  for (const row of rows) bytes += gzipSync(await readFile(join(root, row.path))).length;
  return bytes;
}
const sum = (rows) => rows.reduce((total, file) => total + file.bytes, 0);
const js = assets.filter((file) => file.path.endsWith('.js'));
const lazy = js.filter((file) => !visited.has(file.path));
const packageSizes = {};
for (const [key, path] of Object.entries({
  desktopApp: 'release/mac-arm64/Moose.app',
  dmg: `release/Moose-${version}-arm64.dmg`,
  web: `release/Moose-${version}-web-darwin-arm64.tar.gz`,
})) {
  try {
    const info = await stat(join(root, path));
    packageSizes[key] = info.isDirectory() ? sum(await files(join(root, path))) : info.size;
  } catch {
    packageSizes[key] = null;
  }
}
// Packaging drops source maps, so the backend entries are counted the same way.
const backend = {};
for (const file of await files(join(root, 'dist-electron')).catch(() => []))
  if (!file.path.endsWith('.map')) {
    const entry = file.path.split('/')[1];
    backend[entry] = (backend[entry] || 0) + file.bytes;
  }
/** Bytes inside app.asar by top-level directory (dist-electron by entry), from the archive header. */
async function asarEntries() {
  for (const path of [
    'release/mac-arm64/Moose.app/Contents/Resources/app.asar',
    'release/linux-unpacked/resources/app.asar',
  ]) {
    let handle;
    try {
      handle = await open(join(root, path));
    } catch {
      continue;
    }
    try {
      const head = Buffer.alloc(16);
      await handle.read(head, 0, 16, 0);
      const json = Buffer.alloc(head.readUInt32LE(12));
      await handle.read(json, 0, json.length, 16);
      const entries = {};
      let unpacked = 0;
      const walk = (node, prefix) => {
        for (const [name, child] of Object.entries(node.files || {})) {
          const path = prefix ? `${prefix}/${name}` : name;
          if (child.files) walk(child, path);
          else if (child.unpacked) unpacked += child.size || 0;
          else if (child.size) {
            const parts = path.split('/');
            const key = parts.slice(0, parts[0] === 'dist-electron' ? 2 : 1).join('/');
            entries[key] = (entries[key] || 0) + child.size;
          }
        }
      };
      walk(JSON.parse(json.toString('utf8')), '');
      return { path, bytes: (await handle.stat()).size, entries, unpackedBytes: unpacked };
    } finally {
      await handle.close();
    }
  }
  return null;
}
console.log(
  JSON.stringify(
    {
      version,
      definition:
        'sum of regular file lengths; gzip per JS resource; entry is static import graph (not a network waterfall); backend is dist-electron per entry directory without source maps; asar is packed bytes by top-level directory from the archive header',
      totalBytes: sum(assets),
      files: assets,
      entry: {
        bytes: sum(entry),
        gzipBytes: await gzipBytes(entry),
        files: entry.map((row) => row.path),
      },
      lazy: { bytes: sum(lazy), gzipBytes: await gzipBytes(lazy), count: lazy.length },
      backend,
      packages: packageSizes,
      asar: await asarEntries(),
    },
    null,
    2,
  ),
);
