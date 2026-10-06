import { defineConfig } from 'vitest/config';

// DATABASE_URL comes from packages/domain/.env (the same file the Prisma CLI reads).
try {
  process.loadEnvFile('.env');
} catch {
  // No .env: rely on the caller's environment (CI).
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Lock tests share one database and contend on purpose; run files sequentially.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
