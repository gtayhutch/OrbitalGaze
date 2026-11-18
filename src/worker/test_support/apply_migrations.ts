/**
 * @fileoverview Test setup: applies the database migrations before each test file.
 *
 * Layer: worker test support (runs inside workerd during `pnpm test` only).
 *
 * The migration files are read in Node.js by `vitest.worker.config.ts` and
 * handed to the runtime as the `TEST_MIGRATIONS` binding. Applying them here
 * means each test file starts with the current schema and no rows. Storage is
 * isolated per test file, so tests can't see each other's data.
 */
import {applyD1Migrations, type D1Migration} from 'cloudflare:test';
import {env} from 'cloudflare:workers';

/** The bindings available in tests: the app's bindings plus the migrations. */
interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;
await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
