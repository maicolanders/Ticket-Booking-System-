import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Concurrency tests share a database; run test files sequentially.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
