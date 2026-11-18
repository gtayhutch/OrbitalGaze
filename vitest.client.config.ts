/**
 * @fileoverview Test project for the browser app.
 *
 * Components render into jsdom, a simulated browser DOM. jsdom has no WebGL,
 * so tests replace the Cesium globe with a stand-in; the real globe is covered
 * by the Playwright end-to-end tests in a real browser.
 */
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    name: 'client',
    environment: 'jsdom',
    include: ['src/client/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/client/test_support/setup.ts'],
  },
});
