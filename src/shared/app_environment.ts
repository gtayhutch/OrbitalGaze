/**
 * @fileoverview The names of the environments OrbitalGaze runs in.
 *
 * Layer: shared (used by both the browser app and the Worker; no I/O).
 *
 * The Worker reads its environment name from the `APP_ENV` variable in
 * wrangler.jsonc and reports it through the health endpoint. The browser app
 * uses it to show an environment badge everywhere except production, so
 * nobody mistakes staging for the real site.
 */
import {z} from 'zod';

/**
 * Every environment the app can run in, from least to most important.
 *
 * - `test`: a developer's machine and the automated tests.
 * - `staging`: the hosted release candidate.
 * - `production`: the public site at orbitalgaze.com.
 */
export const APP_ENVIRONMENTS = ['test', 'staging', 'production'] as const;

/** Validates an environment name, rejecting anything not in {@link APP_ENVIRONMENTS}. */
export const AppEnvironmentSchema = z.enum(APP_ENVIRONMENTS);

/** One of the environment names in {@link APP_ENVIRONMENTS}. */
export type AppEnvironment = z.infer<typeof AppEnvironmentSchema>;
