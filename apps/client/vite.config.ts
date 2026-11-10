import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works from any folder or static host.
  base: './',
  resolve: {
    // Use the shared package's TypeScript source directly, no prebuild needed.
    alias: { '@tidebound/shared': new URL('../../packages/shared/src/index.ts', import.meta.url).pathname },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
