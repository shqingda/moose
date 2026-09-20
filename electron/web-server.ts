/** Loopback-bound browser host with an optional trusted HTTPS tunnel origin. A disconnected browser never owns task lifetime. */
import { createServer, type ServerResponse, type IncomingMessage } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  realpath,
  unlink,
  readdir,
  stat,
  writeFile,
  rename,
} from 'node:fs/promises';
import { resolve, join, extname, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { Store } from './db/store';
import { nativeDirectoryAvailable, pickWebDirectory } from './web-directory-dialog';
import { MooseService } from './service';
import type { AppEvent } from '../shared/types';

const root = resolve(fileURLToPath(new URL(/* @vite-ignore */ '.', import.meta.url)), '../../dist');
const data = resolve(process.env.MOOSE_WEB_DATA_DIR || join(homedir(), '.moose/web'));
const publicOrigin = process.env.MOOSE_WEB_PUBLIC_ORIGIN || '';
if (publicOrigin) {
  const url = new URL(publicOrigin);
  if (url.protocol !== 'https:' || url.origin !== publicOrigin)
    throw new Error('MOOSE_WEB_PUBLIC_ORIGIN must be an HTTPS origin without a path');
}
await mkdir(data, { recursive: true, mode: 0o700 });
// Take ownership before Store's interrupted-task recovery can touch this database.
const lockPath = join(await realpath(data), 'server.lock');
const lock = await open(lockPath, 'wx', 0o600).catch(() => {
  throw new Error(
    `Web service already owns this data directory, or stopped unexpectedly. Check ${lockPath} before removing a stale lock.`,
  );
});
await lock.writeFile(String(process.pid));
const clients = new Set<ServerResponse>();
const dialogs = new Set<AbortController>();
function emit(event: AppEvent) {
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    if (client.writableLength > 1024 * 1024) client.destroy();
    else client.write(frame);
  }
}
const store = new Store(join(data, 'moose.sqlite'));
const service = new MooseService(store, emit);
const secret = randomBytes(32).toString('hex');
const connectionFile = join(data, 'connection.json');
const sessions = new Set<string>();
const equal = (value: string, expected: string) =>
  value.length === expected.length && timingSafeEqual(Buffer.from(value), Buffer.from(expected));
let origin = '';
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 28 * 1024 * 1024) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const server = createServer(async (req, res) => {
  try {
    const requestOrigin = [origin, publicOrigin].find(
      (allowed) => allowed && new URL(allowed).host === req.headers.host,
    );
    if (!requestOrigin || (req.headers.origin && req.headers.origin !== requestOrigin)) {
      json(res, 403, { error: 'Untrusted origin' });
      return;
    }
    const url = new URL(req.url || '/', requestOrigin);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'",
    );
    if (url.pathname === '/api/login' && req.method === 'POST') {
      if (req.headers.origin !== requestOrigin) {
        json(res, 403, { error: 'Untrusted origin' });
        return;
      }
      const input = await body(req);
      if (typeof input.token !== 'string' || !equal(input.token, secret)) {
        json(res, 401, { error: 'Invalid access token' });
        return;
      }
      if (sessions.size >= 32) {
        json(res, 429, {
          error: 'Too many browser sessions; restart the service to reset access.',
        });
        return;
      }
      const session = randomBytes(32).toString('hex');
      sessions.add(session);
      res.setHeader(
        'Set-Cookie',
        `moose_session=${session}; HttpOnly; SameSite=Strict; Path=/${requestOrigin.startsWith('https:') ? '; Secure' : ''}`,
      );
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const cookie = req.headers.cookie
        ?.split(';')
        .map((v) => v.trim())
        .find((v) => v.startsWith('moose_session='))
        ?.slice(14);
      if (!cookie || !sessions.has(cookie)) {
        json(res, 401, { error: 'Open the access link printed by the Moose web service.' });
        return;
      }
      if (url.pathname === '/api/events' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        });
        clients.add(res);
        res.write(
          `data: ${JSON.stringify({ type: 'changed' })}\n\ndata: ${JSON.stringify({ type: 'terminal-sync' })}\n\n`,
        );
        req.on('close', () => clients.delete(res));
        return;
      }
      if (url.pathname === '/api/request' && req.method === 'POST') {
        if (
          req.headers.origin !== requestOrigin ||
          !req.headers['content-type']?.startsWith('application/json')
        ) {
          json(res, 403, { error: 'Untrusted request' });
          return;
        }
        const input = await body(req);
        if (typeof input.method !== 'string' || input.method.startsWith('_'))
          throw new Error('Unknown operation');
        const clientId =
          typeof input.clientId === 'string' &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.clientId)
            ? input.clientId
            : undefined;
        if (
          ['terminalControl', 'terminalInput', 'terminalResize'].includes(input.method) &&
          !clientId
        )
          throw new Error('Missing terminal client identity');
        let result: unknown;
        if (input.method === 'webRuntimeStatus')
          result = { data: await realpath(data), pid: process.pid };
        else if (input.method === 'webDisconnect') {
          sessions.delete(cookie);
          result = null;
        } else if (input.method === 'webStopService') {
          json(res, 200, { result: null });
          setImmediate(() => void stop());
          return;
        } else if (input.method === 'webPickDirectory') {
          if (requestOrigin === publicOrigin || !nativeDirectoryAvailable())
            result = { supported: false };
          else {
            const controller = new AbortController();
            const abort = () => controller.abort();
            dialogs.add(controller);
            res.once('close', abort);
            try {
              result = { supported: true, path: await pickWebDirectory(controller.signal) };
            } finally {
              res.off('close', abort);
              dialogs.delete(controller);
            }
          }
        } else if (input.method === 'webDirectories') {
          const requested = input.params?.path || homedir();
          if (typeof requested !== 'string' || !isAbsolute(requested) || requested.length > 4096)
            throw new Error('Choose an absolute directory on the server');
          const path = await realpath(requested);
          if (!(await stat(path)).isDirectory()) throw new Error('Not a directory');
          const entries = await readdir(path, { withFileTypes: true });
          const directories = entries
            .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
            .map((entry) => ({ name: entry.name, path: join(path, entry.name) }))
            .sort((a, b) => a.name.localeCompare(b.name));
          result = { path, parent: dirname(path), directories };
        } else if (input.method === 'webAddProject') {
          if (
            typeof input.params?.path !== 'string' ||
            !isAbsolute(input.params.path) ||
            input.params.path.length > 4096
          )
            throw new Error('Choose an absolute directory on the server');
          result = await service.addProject(input.params.path);
        } else result = await service.handle(input.method, input.params, clientId ?? 'legacy-web');
        json(res, 200, { result });
        return;
      }
      json(res, 404, { error: 'Unknown endpoint' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }
    const path = resolve(
      root,
      '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname),
    );
    const rel = relative(root, path);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const bytes = await readFile(path);
    const mime: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.woff2': 'font/woff2',
      '.txt': 'text/plain',
    };
    res.writeHead(200, {
      'Content-Type': mime[extname(path)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch (error) {
    if (!res.headersSent)
      json(res, 400, { error: error instanceof Error ? error.message : 'Request failed' });
    else res.destroy();
  }
});
server.requestTimeout = 30000;
server.headersTimeout = 10000;
const heartbeat = setInterval(() => {
  for (const client of clients) client.write(': heartbeat\n\n');
}, 15000);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(heartbeat);
  for (const dialog of dialogs) dialog.abort();
  for (const client of clients) client.end();
  server.close();
  server.closeAllConnections();
  await service.close();
  await unlink(connectionFile).catch(() => {});
  await lock.close();
  await unlink(lockPath);
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
try {
  const port = Number(process.env.MOOSE_WEB_PORT || 4318);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid web port');
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Web service did not bind');
  origin = `http://127.0.0.1:${address.port}`;
  const connectionTemp = connectionFile + '.' + process.pid;
  await writeFile(connectionTemp, JSON.stringify({ origin, token: secret }), {
    mode: 0o600,
    flag: 'wx',
  });
  await rename(connectionTemp, connectionFile);
  console.log(`Desktop connection: ${connectionFile}`);
  console.log(`Moose Web: ${origin}/#token=${secret}`);
  console.log(
    `Data: ${data}\nClosing a browser does not stop tasks. Ctrl+C stops this service and its tasks.`,
  );
} catch (error) {
  await stop();
  throw error;
}
