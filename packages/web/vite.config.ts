import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The shared workspace package ships TS source, so let Vite transpile it
// instead of trying to pre-bundle it as a dependency.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  preview: { port: 4173 },
  optimizeDeps: { exclude: ['@ticket/shared'] },
});
