import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// ARTIFACT=1 builds a relative-path bundle for publishing as a claude.ai artifact (see scripts/build-artifact.mjs)
const artifact = !!process.env.ARTIFACT;

export default defineConfig({
  root: 'src/client',
  base: artifact ? './' : '/',
  publicDir: '../../public',
  build: {
    outDir: artifact ? '../../dist/artifact' : '../../dist/client',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/client/index.html'),
        // developer-only model/map preview page: `INCLUDE_PREVIEW=1 npm run build:client`
        ...(process.env.INCLUDE_PREVIEW ? { preview: resolve(__dirname, 'src/client/preview.html') } : {}),
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
      '/healthz': 'http://localhost:8080',
    },
  },
});
