// 原生鼠标验收：在临时数据目录启动应用，等待实际点击完成侧栏收起和展开。
import { _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../electron/db/store';
const dir = await mkdtemp(join(tmpdir(), 'moose-native-ui-'));
const store = new Store(join(dir, 'moose.sqlite'));
store.setSettings({ language: 'en' });
store.addProject(dir);
store.close();
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === 'string' && entry[0] !== 'ELECTRON_RUN_AS_NODE',
  ),
);
const app = await electron.launch({ args: ['.'], env: { ...env, MOOSE_DATA_DIR: dir } });
try {
  const page = await app.firstWindow();
  await page.waitForSelector('.app-shell');
  console.log('Ready for native mouse: close sidebar, then reopen it.');
  await page.waitForFunction(
    () => document.querySelector('.sidebar-frame')?.hasAttribute('inert'),
    undefined,
    { timeout: 120000 },
  );
  console.log('Native sidebar close received.');
  await page.waitForFunction(
    () => !document.querySelector('.sidebar-frame')?.hasAttribute('inert'),
    undefined,
    { timeout: 120000 },
  );
  console.log('Native sidebar reopen received.');
  await page.screenshot({ path: 'test-results/native-sidebar.png' });
} finally {
  await app.close();
  await rm(dir, { recursive: true, force: true });
}
