import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Workspace packages ship TS source, so they are bundled; node_modules
  // (Prisma client, Azure SDKs) stay external and resolve at runtime.
  noExternal: ['@ticket/shared', '@ticket/domain'],
  skipNodeModulesBundle: true,
});
