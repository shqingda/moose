// 发行包验收：先验证签名，再用临时数据启动 .app，检查版本、沙箱和 SQLite。
import { execFileSync } from 'node:child_process';
import { _electron as electron } from '@playwright/test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
execFileSync('/usr/bin/codesign', [
  '--verify',
  '--deep',
  '--strict',
  resolve('release/mac-arm64/Moose.app'),
]);
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const dir = await mkdtemp(join(tmpdir(), 'moose-package-'));
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === 'string' && entry[0] !== 'ELECTRON_RUN_AS_NODE',
  ),
);
const app = await electron.launch({
  executablePath: resolve('release/mac-arm64/Moose.app/Contents/MacOS/Moose'),
  env: { ...env, MOOSE_DATA_DIR: dir },
});
try {
  const page = await app.firstWindow();
  await page.waitForSelector('.app-shell');
  const details = await app.evaluate(({ app, BrowserWindow }) => ({
    version: app.getVersion(),
    sandbox: (
      BrowserWindow.getAllWindows()[0].webContents as unknown as {
        getLastWebPreferences(): { sandbox: boolean };
      }
    ).getLastWebPreferences().sandbox,
  }));
  const snapshot = await page.evaluate(() => window.moose.request('snapshot', {}));
  if (details.version !== version || !details.sandbox || !Array.isArray(snapshot.projects))
    throw new Error('Packaged smoke failed');
  await page.screenshot({ path: `test-results/package-${version}.png` });
  console.log(JSON.stringify({ ...details, sqlite: 'ready' }));
} finally {
  await app.close();
  await rm(dir, { recursive: true, force: true });
}
