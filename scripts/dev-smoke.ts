// 开发生命周期验收：临时修改入口文件，检查 HMR / 重启行为，再恢复原文件。
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
const data = await mkdtemp(join(tmpdir(), 'moose-dev-smoke-'));
const proc = spawn('pnpm', ['dev'], {
  detached: true,
  env: { ...process.env, MOOSE_DATA_DIR: data, REMOTE_DEBUGGING_PORT: '9337' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const files = ['src/main.tsx', 'electron/preload.ts', 'electron/runtime.ts', 'electron/main.ts'];
const originals = new Map(
  await Promise.all(files.map(async (path) => [path, await readFile(path, 'utf8')] as const)),
);
// 追加测试标记以触发开发构建，结束后由清理逻辑恢复。
const touch = (path: string) =>
  writeFile(path, originals.get(path)! + '\n// Moose development lifecycle acceptance test\n');
let log = '';
proc.stdout.on('data', (data) => {
  log += data;
});
proc.stderr.on('data', (data) => {
  log += data;
});
// 循环等待开发服务达到目标状态，超时则使验收失败。
const waitFor = async (condition: () => Promise<boolean>) => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      if (await condition()) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Dev smoke timed out\n${log.slice(-2500)}`);
};
// 读取 Electron 的 CDP 调试端点，用连接标识判断窗口或进程是否重启。
const endpoint = async () =>
  (await (await fetch('http://127.0.0.1:9337/json/version')).json()) as {
    webSocketDebuggerUrl: string;
  };
try {
  await waitFor(async () => !!(await endpoint()).webSocketDebuggerUrl);
  let id = (await endpoint()).webSocketDebuggerUrl;
  let browser = await chromium.connectOverCDP('http://127.0.0.1:9337');
  let page = browser.contexts()[0].pages()[0];
  page.on('console', (message) => {
    log += `\n[renderer ${message.type()}] ${message.text()}`;
  });
  page.on('pageerror', (error) => {
    log += `\n[pageerror] ${error.message}`;
  });
  await page.waitForSelector('.app-shell');
  console.log('Dev page:', page.url());
  console.log('PASS first launch: all three targets ready and sandboxed preload operational');
  await writeFile(
    'src/main.tsx',
    originals.get('src/main.tsx')! + '\ndocument.documentElement.dataset.mooseHmr = "verified";\n',
  );
  await waitFor(
    async () =>
      (await page.evaluate(() => document.documentElement.dataset.mooseHmr)) === 'verified',
  );
  console.log('PASS renderer hot update');
  const loaded = page.waitForEvent('load', { timeout: 20000 });
  await touch('electron/preload.ts');
  await loaded;
  await page.waitForSelector('.app-shell');
  if ((await endpoint()).webSocketDebuggerUrl !== id)
    throw new Error('Preload reload restarted Electron');
  console.log('PASS preload reload without main-process restart');
  await touch('electron/runtime.ts');
  await waitFor(async () => (await endpoint()).webSocketDebuggerUrl !== id);
  id = (await endpoint()).webSocketDebuggerUrl;
  browser = await chromium.connectOverCDP('http://127.0.0.1:9337');
  page = browser.contexts()[0].pages()[0];
  await page.waitForSelector('.app-shell');
  console.log('PASS runtime hot restart');
  await touch('electron/main.ts');
  await waitFor(async () => (await endpoint()).webSocketDebuggerUrl !== id);
  browser = await chromium.connectOverCDP('http://127.0.0.1:9337');
  page = browser.contexts()[0].pages()[0];
  await page.waitForSelector('.app-shell');
  console.log('PASS main hot restart');
} finally {
  try {
    process.kill(-proc.pid!, 'SIGTERM');
  } catch {}
  await Promise.all([...originals].map(([path, text]) => writeFile(path, text)));
}
