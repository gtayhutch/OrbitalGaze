/**
 * @fileoverview Build and dev-server configuration for the whole app.
 *
 * Vite builds the React client, and the Cloudflare plugin builds and runs the
 * Worker in the real Workers runtime (workerd) during `pnpm dev` and
 * `vite preview`, so local behavior matches production closely.
 *
 * The globe's map library, MapLibre, parses tiles in web workers. Its worker
 * script is imported with `?worker&url` (see `create_map.ts`), so builds emit
 * it as a separate file on our own origin. In `pnpm dev` the library is
 * served unbundled (`optimizeDeps.exclude`), so the worker loads next to it.
 */
import {cloudflare} from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  define: {
    // Exposed on the health response so CI can test the deployed commit.
    ORBITALGAZE_DEPLOY_REVISION: JSON.stringify(
      process.env['WORKERS_CI_COMMIT_SHA'] ?? '',
    ),
    ORBITALGAZE_BUILD_ENVIRONMENT: JSON.stringify(
      process.env['CLOUDFLARE_ENV'] ?? 'test',
    ),
  },
  build: {
    // MapLibre is one ~1.1 MB chunk that can't be split further. It loads
    // lazily after the app shell, so raise the warning threshold just above
    // it; anything else growing past this limit still gets flagged.
    chunkSizeWarningLimit: 1_200,
  },
  optimizeDeps: {
    // Pre-bundling would move MapLibre away from its worker file; see the
    // header.
    exclude: ['maplibre-gl'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
