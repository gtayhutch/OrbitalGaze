/**
 * @fileoverview Validated Worker configuration.
 *
 * Layer: worker library (server only).
 *
 * This is the only module that reads plain settings from the Worker's `env`
 * object. Everything else receives the typed {@link WorkerConfig} it returns,
 * so a missing or misspelled setting fails loudly in one place instead of
 * surfacing later as `undefined` deep inside a feature. Bindings such as the
 * database are still taken from `env` by route handlers and passed down.
 */
import {z} from 'zod';

import {
  AppEnvironmentSchema,
  type AppEnvironment,
} from '@/shared/app_environment';

/** The settings the Worker needs, after validation. */
export interface WorkerConfig {
  /** Which environment this Worker is running in. */
  readonly appEnvironment: AppEnvironment;
}

/**
 * Shape of the raw settings in `env`. Unknown keys (including bindings like
 * `DB`) are ignored here.
 */
const RawWorkerSettingsSchema = z.object({
  APP_ENV: AppEnvironmentSchema,
});

/** Thrown when the Worker's settings are missing or invalid. */
export class ConfigError extends Error {
  /**
   * @param details A summary of which settings failed and why. It names
   *     settings, never their values, so it is safe to log.
   */
  constructor(details: string) {
    super(`Invalid Worker configuration: ${details}`);
    this.name = 'ConfigError';
  }
}

/**
 * Reads and validates the Worker's settings.
 *
 * @param env The Worker's `env` object, or any object with the same settings.
 * @returns The typed configuration.
 * @throws {ConfigError} If a setting is missing or has an unexpected value.
 *     This is a deployment mistake, not a user error, so it surfaces as a 500.
 * @example
 * const config = parseWorkerConfig(env);
 * config.appEnvironment; // "test", "staging", or "production"
 */
export function parseWorkerConfig(env: unknown): WorkerConfig {
  const result = RawWorkerSettingsSchema.safeParse(env);
  if (!result.success) {
    // List the failing setting names only; values could be sensitive.
    const failingSettings = result.error.issues
      .map(issue => issue.path.join('.') || '(root)')
      .join(', ');
    throw new ConfigError(failingSettings);
  }
  return {appEnvironment: result.data.APP_ENV};
}
