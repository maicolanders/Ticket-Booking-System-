import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Bundle the workspace packages (they ship TS source, not a build).
  noExternal: ['@ticket/shared', '@ticket/domain'],
  // Prisma client and other node_modules stay external and resolve at runtime.
  skipNodeModulesBundle: true,
});
