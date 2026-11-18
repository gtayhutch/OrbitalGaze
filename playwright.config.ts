/**
 * @fileoverview End-to-end test configuration (Playwright).
 *
 * The tests run against the production build served by `vite preview`, which
 * runs the built Worker in the local Workers runtime, so they exercise the
 * same files that would be deployed.
 *
 * Chromium draws WebGL with SwiftShader, a software renderer, so the globe
 * renders on CI machines without a GPU.
 */
import {defineConfig, devices} from '@playwright/test';

/** Port for the preview server; distinct from the dev server's 5173. */
const PREVIEW_PORT = 4173;

/** True when running in GitHub Actions or another CI system. */
const IS_CI = process.env['CI'] !== undefined;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: IS_CI,
  retries: IS_CI ? 1 : 0,
  reporter: IS_CI ? [['list'], ['html', {open: 'never'}]] : 'list',
  use: {
    baseURL: `http://localhost:${PREVIEW_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
  webServer: {
    // Expects `pnpm build` to have run first (as `pnpm verify` does).
    // Seeds the local database (synthetic cameras) before serving.
    command: `pnpm db:seed && pnpm exec vite preview --port ${PREVIEW_PORT} --strictPort`,
    url: `http://localhost:${PREVIEW_PORT}`,
    reuseExistingServer: !IS_CI,
    timeout: 120_000,
  },
});
