// Electron 端到端测试配置；测试通过隔离数据目录启动真实客户端。
import { defineConfig } from '@playwright/test';
// Explicit opt-out for native focus and foreground acceptance.
process.env.MOOSE_TEST_BACKGROUND ??= '1';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  workers: 1,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
});
