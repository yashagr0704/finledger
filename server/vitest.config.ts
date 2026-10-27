import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, '../src') } },
  test: { root: path.resolve(__dirname), include: ['test/**/*.test.ts'], testTimeout: 60000, hookTimeout: 120000, env: { NODE_ENV: 'test' } },
});
