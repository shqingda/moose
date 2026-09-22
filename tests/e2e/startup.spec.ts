import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, chmod, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultSettings } from '../../shared/types';

test('reveals first and subsequent desktop windows only after the hydrated frame is ready', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'moose-startup-'));
  const streams = new Set<ServerResponse>();
  const server = createServer(async (request, response) => {
    const json = (result: unknown) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ result }));
    };
    if (request.url === '/api/login') {
      response.setHeader('Set-Cookie', 'moose_session=startup-test; HttpOnly; SameSite=Strict');
      json(null);
      return;
    }
    if (request.url === '/api/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      response.write(': connected\n\n');
      streams.add(response);
      response.on('close', () => streams.delete(response));
      return;
    }
    if (request.url === '/api/request') {
      let input = '';
      for await (const chunk of request) input += chunk;
      const method = (JSON.parse(input) as { method: string }).method;
      if (method === 'snapshot') {
        // Keep the boot tree painted long enough to catch an eager ready-to-show reveal.
        await new Promise((resolve) => setTimeout(resolve, 800));
        json({
          projects: [],
          sessions: [],
          settings: { ...defaultSettings, theme: 'dark', language: 'en' },
          locale: 'en-US',
          dark: true,
          reduceMotion: false,
          reduceTransparency: false,
          highContrast: false,
        });
        return;
      }
      json(method === 'providers' ? [] : null);
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing startup test server');
  const connection = join(directory, 'connection.json');
  await writeFile(
    connection,
    JSON.stringify({ origin: `http://127.0.0.1:${address.port}/`, token: 'startup-test' }),
    { mode: 0o600 },
  );
  await chmod(connection, 0o600);

  let app: ElectronApplication | undefined;
  const launch = async (name: string) => {
    const env = Object.fromEntries(
      Object.entries({
        ...process.env,
        MOOSE_DATA_DIR: directory,
        MOOSE_SHARED_RUNTIME_FILE: connection,
        MOOSE_TEST_BACKGROUND: '0',
      }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ args: ['.'], env });
    const page = await app.firstWindow();
    await expect(page.locator('.boot-screen')).toBeAttached();
    await page.waitForTimeout(200);
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
    ).toBe(false);
    await expect(page.locator('.app-shell')).toBeAttached();
    await expect
      .poll(() =>
        app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
      )
      .toBe(true);
    await expect(page.locator('.boot-screen')).toHaveCount(0);
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.screenshot({ path: `test-results/startup-${name}.png`, animations: 'disabled' });
  };

  try {
    await launch('first');
    await app!.close();
    app = undefined;
    await launch('subsequent');
  } finally {
    await app?.close().catch(() => {});
    for (const stream of streams) stream.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
