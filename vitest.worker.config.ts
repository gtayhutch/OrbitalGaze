/**
 * @fileoverview Test project for Worker code.
 *
 * Tests run inside workerd, the same runtime Cloudflare uses in production,
 * configured from wrangler.jsonc (the local environment). Bindings such as
 * D1 are real local implementations, not mocks. The migrations in
 * `migrations/` are read here and applied by the setup file before each test
 * file runs, so every test file starts from a migrated, empty database.
 */
import {cloudflareTest, readD1Migrations} from '@cloudflare/vitest-plugin';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: {configPath: './wrangler.jsonc'},
      miniflare: {
        // Passed to the setup file as `env.TEST_MIGRATIONS`.
        bindings: {TEST_MIGRATIONS: await readD1Migrations('./migrations')},
      },
    })),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    name: 'worker',
    include: ['src/worker/**/*.test.ts', 'src/shared/**/*.test.ts'],
    setupFiles: ['./src/worker/test_support/apply_migrations.ts'],
  },
});
