import { defineConfig } from 'vitest/config';

// Unit tests: the orchestrator runs against a scripted fake context (no host, no database).
export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
