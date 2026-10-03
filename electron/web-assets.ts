import { open } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { constants, createGzip } from 'node:zlib';

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
const compressible = new Set(['.html', '.js', '.css', '.svg', '.txt']);

function acceptsGzip(header = '') {
  const encodings = header
    .toLowerCase()
    .split(',')
    .map((value) => value.trim().split(';'));
  const entry =
    encodings.find(([name]) => name.trim() === 'gzip') ??
    encodings.find(([name]) => name.trim() === '*');
  if (!entry) return false;
  const quality = entry.slice(1).find((value) => value.trim().startsWith('q='));
  const q = quality === undefined ? 1 : Number(quality.trim().slice(2));
  return q > 0 && q <= 1;
}

/** Stream assets with bounded buffers; cache only Vite's content-addressed files indefinitely. */
export async function serveWebAsset(
  root: string,
  pathname: string,
  req: IncomingMessage,
  res: ServerResponse,
) {
  const path = resolve(root, '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
  const rel = relative(root, path);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    res.writeHead(404);
    res.end();
    return;
  }
  const handle = await open(path, 'r').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    return null;
  });
  if (!handle) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const file = await handle.stat();
    if (!file.isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    const extension = extname(path);
    const canCompress = compressible.has(extension) && file.size >= 1024;
    const gzip = canCompress && acceptsGzip(req.headers['accept-encoding']);
    const etag = `W/"${file.size.toString(16)}-${file.mtimeMs.toString(16)}-${gzip ? 'gzip' : 'identity'}"`;
    res.setHeader('Content-Type', mime[extension] || 'application/octet-stream');
    res.setHeader(
      'Cache-Control',
      /^assets\/.+-[\w-]{8,}\.[\w]+$/.test(rel)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    );
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', file.mtime.toUTCString());
    if (canCompress) res.setHeader('Vary', 'Accept-Encoding');
    if (gzip) res.setHeader('Content-Encoding', 'gzip');

    const match = req.headers['if-none-match'];
    const modified = req.headers['if-modified-since'];
    const fresh =
      match !== undefined
        ? match
            .split(',')
            .some(
              (value) => value.trim() === '*' || value.trim().replace(/^W\//, '') === etag.slice(2),
            )
        : modified !== undefined && Math.floor(file.mtimeMs / 1000) * 1000 <= Date.parse(modified);
    if (fresh) {
      res.writeHead(304);
      res.end();
      return;
    }
    if (!gzip) res.setHeader('Content-Length', file.size);
    res.writeHead(200);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const source = handle.createReadStream({ autoClose: false });
    if (gzip) await pipeline(source, createGzip({ level: constants.Z_BEST_SPEED }), res);
    else await pipeline(source, res);
  } finally {
    await handle.close();
  }
}
