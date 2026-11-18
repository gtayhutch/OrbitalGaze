/**
 * @fileoverview Root test configuration: runs the client and Worker test suites.
 *
 * The two sides run in different environments, so each has its own project:
 * - `vitest.worker.config.ts`: Worker code inside the real Workers runtime,
 *   with a real local D1 database.
 * - `vitest.client.config.ts`: React components in a simulated browser DOM.
 */
import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['./vitest.worker.config.ts', './vitest.client.config.ts'],
  },
});
