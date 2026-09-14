// Vitest 配置：限定单元测试范围与运行环境。
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/unit/**/*.test.ts'], testTimeout: 15000 } });
