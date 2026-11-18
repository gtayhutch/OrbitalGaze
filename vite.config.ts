/**
 * @fileoverview Build and dev-server configuration for the whole app.
 *
 * Vite builds the React client, and the Cloudflare plugin builds and runs the
 * Worker in the real Workers runtime (workerd) during `pnpm dev` and
 * `vite preview`, so local behavior matches production closely.
 *
 * CesiumJS loads extra files at run time (web workers, images, widget styles,
 * third-party code), and `CESIUM_BASE_URL` tells it where they live. They are
 * always served from our own origin, which keeps the Content Security Policy
 * free of third-party script hosts:
 * - In a build, they are copied from the cesium package into `/cesium/`.
 * - In `pnpm dev`, Vite serves them straight from node_modules. (The
 *   Cloudflare plugin answers unknown paths with index.html, the
 *   single-page-app fallback, so the copy plugin can't serve them in dev.)
 *
 * Builds also remove the one `eval` call in Cesium's bundled Knockout, so the
 * page never needs `'unsafe-eval'` (`scripts/cesium_no_eval_plugin.ts`).
 */
import {cloudflare} from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';
import {viteStaticCopy} from 'vite-plugin-static-copy';

import {cesiumNoEval} from './scripts/cesium_no_eval_plugin';

/** Where Cesium's package keeps the prebuilt runtime files it loads at run time. */
const CESIUM_SOURCE_DIRECTORY = 'node_modules/cesium/Build/Cesium';

/** The public URL path the Cesium runtime files are copied to in a build. */
const CESIUM_BUILD_PATH = 'cesium';

export default defineConfig(({command}) => ({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare(),
    // Removes the one eval call in Cesium's bundled Knockout, which our
    // Content Security Policy doesn't allow; see the plugin's header.
    cesiumNoEval(),
    viteStaticCopy({
      targets: ['Workers', 'ThirdParty', 'Assets', 'Widgets'].map(folder => ({
        src: `${CESIUM_SOURCE_DIRECTORY}/${folder}`,
        dest: CESIUM_BUILD_PATH,
        // The plugin keeps the source path by default. Strip the four
        // leading folders (node_modules/cesium/Build/Cesium) so that, for
        // example, Workers/ lands at /cesium/Workers/.
        rename: {stripBase: CESIUM_SOURCE_DIRECTORY.split('/').length},
      })),
    }),
  ],
  define: {
    // Exposed on the health response so CI can test the deployed commit.
    ORBITALGAZE_DEPLOY_REVISION: JSON.stringify(
      process.env['WORKERS_CI_COMMIT_SHA'] ?? '',
    ),
    // Cesium reads this global to locate its runtime files; see the header.
    CESIUM_BASE_URL: JSON.stringify(
      command === 'serve'
        ? `/${CESIUM_SOURCE_DIRECTORY}`
        : `/${CESIUM_BUILD_PATH}`,
    ),
  },
  build: {
    // CesiumJS is one ~4.5 MB chunk that can't be split further. It loads
    // lazily after the app shell, so raise the warning threshold above it;
    // anything else growing past this limit still gets flagged.
    chunkSizeWarningLimit: 5000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
}));
