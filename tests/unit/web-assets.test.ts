import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer, request, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { serveWebAsset } from '../../electron/web-assets';

describe('Web asset delivery', () => {
  let temporary: string;
  let port: number;
  const html = '<!doctype html><title>Moose</title>' + '<p>Local workspace</p>'.repeat(200);
  const javascript = 'export const message = "Moose";\n'.repeat(1000);
  const server = createServer((req, res) => {
    void serveWebAsset(join(temporary, 'dist'), req.url || '/', req, res).catch(() => {
      if (res.headersSent) res.destroy();
      else {
        res.writeHead(400);
        res.end();
      }
    });
  });
  const get = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
    new Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }>(
      (resolve, reject) => {
        const req = request({ hostname: '127.0.0.1', port, path, headers, method }, async (res) => {
          try {
            const chunks: Buffer[] = [];
            for await (const chunk of res) chunks.push(chunk);
            resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) });
          } catch (error) {
            reject(error);
          }
        });
        req.on('error', reject);
        req.end();
      },
    );

  beforeAll(async () => {
    temporary = await mkdtemp(join(tmpdir(), 'moose-assets-'));
    await mkdir(join(temporary, 'dist/assets'), { recursive: true });
    await Promise.all([
      writeFile(join(temporary, 'dist/index.html'), html),
      writeFile(join(temporary, 'dist/assets/index-Ab12_cd3.js'), javascript),
      writeFile(join(temporary, 'dist/favicon.svg'), '<svg/>'),
      writeFile(join(temporary, 'dist/assets/logo-Ab12_cd3.webp'), Buffer.alloc(2048, 7)),
      writeFile(join(temporary, 'secret.txt'), 'private'),
    ]);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Server did not bind');
    port = address.port;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(temporary, { recursive: true, force: true });
  });

  it('streams compressed text and marks only content-hashed assets immutable', async () => {
    const script = await get('/assets/index-Ab12_cd3.js', { 'Accept-Encoding': 'br, gzip' });
    expect(script.status).toBe(200);
    expect(script.headers['content-encoding']).toBe('gzip');
    expect(script.headers.vary).toBe('Accept-Encoding');
    expect(script.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(script.headers['content-length']).toBeUndefined();
    expect(gunzipSync(script.body).toString()).toBe(javascript);
    expect(script.body.length).toBeLessThan(javascript.length / 10);
    const document = await get('/');
    expect(document.headers['cache-control']).toBe('no-cache');
    expect(document.body.toString()).toBe(html);
  });

  it.each(['gzip;q=0', '*;q=1, gzip;q=0', 'br', ''])(
    'respects unavailable gzip: %s',
    async (encoding) => {
      const result = await get('/assets/index-Ab12_cd3.js', { 'Accept-Encoding': encoding });
      expect(result.headers['content-encoding']).toBeUndefined();
      expect(Number(result.headers['content-length'])).toBe(Buffer.byteLength(javascript));
      expect(result.body.toString()).toBe(javascript);
    },
  );

  it.each(['*;q=0.5', 'GZIP; q=0.5'])('accepts negotiated gzip: %s', async (encoding) => {
    const result = await get('/', { 'Accept-Encoding': encoding });
    expect(result.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(result.body).toString()).toBe(html);
  });

  it('returns HEAD metadata without a body for both negotiated representations', async () => {
    for (const encoding of ['identity', 'gzip']) {
      const headers = { 'Accept-Encoding': encoding };
      const head = await get('/', headers, 'HEAD');
      const full = await get('/', headers);
      expect(head.status).toBe(200);
      expect(head.body.length).toBe(0);
      for (const header of ['etag', 'content-encoding', 'content-length', 'cache-control', 'vary'])
        expect(head.headers[header]).toBe(full.headers[header]);
    }
  });

  it('validates repeat requests and keeps encoding variants and validator precedence separate', async () => {
    const first = await get('/', { 'Accept-Encoding': 'gzip' });
    const cached = await get('/', {
      'Accept-Encoding': 'gzip',
      'If-None-Match': `"old", ${first.headers.etag!.slice(2)}`,
    });
    expect(cached.status).toBe(304);
    expect(cached.body.length).toBe(0);
    expect(cached.headers.etag).toBe(first.headers.etag);
    expect(cached.headers.vary).toBe('Accept-Encoding');
    expect((await get('/', { 'If-None-Match': first.headers.etag! })).status).toBe(200);
    expect((await get('/', { 'If-Modified-Since': first.headers['last-modified']! })).status).toBe(
      304,
    );
    expect(
      (
        await get('/', {
          'If-None-Match': '"outdated"',
          'If-Modified-Since': first.headers['last-modified']!,
        })
      ).status,
    ).toBe(200);
  });

  it('leaves small and already compressed assets uncompressed', async () => {
    for (const path of ['/favicon.svg', '/assets/logo-Ab12_cd3.webp']) {
      const result = await get(path, { 'Accept-Encoding': 'gzip' });
      expect(result.status).toBe(200);
      expect(result.headers['content-encoding']).toBeUndefined();
      expect(result.headers.vary).toBeUndefined();
    }
    expect((await get('/assets/logo-Ab12_cd3.webp')).headers['content-type']).toBe('image/webp');
  });

  it('rejects encoded traversal, missing paths and directories', async () => {
    for (const path of [
      '/..%2fsecret.txt',
      '/assets/..%2f..%2fsecret.txt',
      '/missing.js',
      '/assets',
    ]) {
      const result = await get(path);
      expect(result.status).toBe(404);
      expect(result.body.length).toBe(0);
    }
  });
});
