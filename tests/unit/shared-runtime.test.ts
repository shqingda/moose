import { afterEach, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SharedRuntime } from '../../electron/shared-runtime';
let directory: string, runtime: SharedRuntime | undefined, server: Server | undefined;
afterEach(async () => {
  await runtime?.close();
  runtime = undefined;
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function config(origin: string, mode = 0o600) {
  directory = await mkdtemp(join(tmpdir(), 'moose-shared-'));
  const file = join(directory, 'connection.json');
  await writeFile(file, JSON.stringify({ origin, token: 'test-token' }), { mode });
  return file;
}
it('rejects non-loopback connection files before sending credentials', async () => {
  runtime = new SharedRuntime(await config('https://example.invalid'), () => {});
  await expect(runtime.request('snapshot', {})).rejects.toThrow('Invalid local');
});
it('rejects connection credentials readable by other users', async () => {
  runtime = new SharedRuntime(await config('http://127.0.0.1:1', 0o644), () => {});
  await expect(runtime.request('snapshot', {})).rejects.toThrow('private');
});
it('does not repeat a write after the response connection is lost', async () => {
  let writes = 0;
  server = createServer((request, response) => {
    if (request.url === '/api/login') {
      response.setHeader('Set-Cookie', 'moose_session=test; HttpOnly');
      response.end('{}');
    } else if (request.url === '/api/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write('data: {"type":"changed"}\n\n');
    } else {
      writes++;
      request.resume();
      request.on('end', () => response.destroy());
    }
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  runtime = new SharedRuntime(await config('http://127.0.0.1:' + address.port), () => {});
  await expect(runtime.request('gitCommit', {})).rejects.toThrow();
  expect(writes).toBe(1);
  await runtime.close();
  expect(server.listening).toBe(true);
});
