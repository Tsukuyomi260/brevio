import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { devApi } from './vite-dev-api';

// https://vite.dev/config/
export default defineConfig({
  // devApi serves api/* from this same server, so `npm run dev` runs the whole
  // app without the Vercel CLI. `npm run dev:vercel` still rehearses the real
  // platform (routing, function boundaries) before deploying.
  plugins: [react(), tailwindcss(), devApi()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
});
