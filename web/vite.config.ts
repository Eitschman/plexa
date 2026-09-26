import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@skill': path.resolve(__dirname, '../skill'),
    },
  },
  server: {
    port: 5173,
    allowedHosts: ['.trycloudflare.com'],
    fs: {
      allow: ['..'],
    },
    proxy: {
      '/api': 'http://localhost:3000',
      '/media': 'http://localhost:3000',
      '/artwork': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
  },
});
