// Electron 端到端测试配置；测试通过隔离数据目录启动真实客户端。
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  workers: 1,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
});
