import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
const data = await mkdtemp(join(tmpdir(), 'moose-dev-smoke-'));
const proc = spawn('pnpm', ['dev'], { detached: true, env: { ...process.env, MOOSE_DATA_DIR: data, REMOTE_DEBUGGING_PORT: '9337' }, stdio: ['ignore', 'pipe', 'pipe'] });
const files = ['src/main.tsx', 'electron/preload.ts', 'electron/runtime.ts', 'electron/main.ts'];
const originals = new Map(await Promise.all(files.map(async path => [path, await readFile(path, 'utf8')] as const)));
const touch = (path: string) => writeFile(path, originals.get(path)! + '\n// Moose development lifecycle acceptance test\n');
let log = ''; proc.stdout.on('data', data => { log += data; }); proc.stderr.on('data', data => { log += data; });
const waitFor = async (condition: () => Promise<boolean>) => { const deadline = Date.now() + 20000; while (Date.now() < deadline) { try { if (await condition()) return; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`Dev smoke timed out\n${log.slice(-2500)}`); };
const endpoint = async () => (await (await fetch('http://127.0.0.1:9337/json/version')).json()) as { webSocketDebuggerUrl: string };
try {
  await waitFor(async () => !!(await endpoint()).webSocketDebuggerUrl);
  let id = (await endpoint()).webSocketDebuggerUrl;
  let browser = await chromium.connectOverCDP('http://127.0.0.1:9337');
  let page = browser.contexts()[0].pages()[0];
  page.on('console', message => { log += `\n[renderer ${message.type()}] ${message.text()}`; });
  page.on('pageerror', error => { log += `\n[pageerror] ${error.message}`; });
  await page.waitForSelector('.app-shell'); console.log('Dev page:', page.url());
  console.log('PASS first launch: all three targets ready and sandboxed preload operational');
  await writeFile('src/main.tsx', originals.get('src/main.tsx')! + '\ndocument.documentElement.dataset.mooseHmr = "verified";\n');
  await waitFor(async () => await page.evaluate(() => document.documentElement.dataset.mooseHmr) === 'verified');
  console.log('PASS renderer hot update');
  const loaded = page.waitForEvent('load', { timeout: 20000 }); await touch('electron/preload.ts'); await loaded; await page.waitForSelector('.app-shell');
  if ((await endpoint()).webSocketDebuggerUrl !== id) throw new Error('Preload reload restarted Electron');
  console.log('PASS preload reload without main-process restart');
  await touch('electron/runtime.ts');
  await waitFor(async () => (await endpoint()).webSocketDebuggerUrl !== id);
  id = (await endpoint()).webSocketDebuggerUrl;
  browser = await chromium.connectOverCDP('http://127.0.0.1:9337'); page = browser.contexts()[0].pages()[0]; await page.waitForSelector('.app-shell');
  console.log('PASS runtime hot restart');
  await touch('electron/main.ts'); await waitFor(async () => (await endpoint()).webSocketDebuggerUrl !== id);
  browser = await chromium.connectOverCDP('http://127.0.0.1:9337'); page = browser.contexts()[0].pages()[0]; await page.waitForSelector('.app-shell');
  console.log('PASS main hot restart');
} finally {
  try { process.kill(-proc.pid!, 'SIGTERM'); } catch {}
  await Promise.all([...originals].map(([path, text]) => writeFile(path, text)));
}
