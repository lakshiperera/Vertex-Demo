import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'node:path';

// HTTPS is required for camera access on phones. basicSsl creates a self-signed
// certificate; the phone shows a warning you accept once.
// `npm run dev:http` (mode "http") skips HTTPS for desktop-only testing on localhost.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'http' ? [] : [basicSsl()],
  server: { host: true, port: mode === 'http' ? 5174 : 5173 },
  preview: { host: true, port: 4173 },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        laptop: resolve(__dirname, 'laptop.html'),
        phone: resolve(__dirname, 'phone.html'),
      },
    },
  },
}));
