// Drizzle 工具配置；运行时实际迁移入口仍是 electron/db/migrations.ts。
import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  dialect: 'sqlite',
  schema: './electron/db/schema.ts',
  out: './electron/db/generated-migrations',
});
