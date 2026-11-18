/**
 * @fileoverview Validated Worker configuration.
 *
 * Layer: worker library (server only).
 *
 * This is the only module that reads plain settings and secrets from the
 * Worker's `env` object. Everything else receives the typed {@link WorkerConfig} it returns,
 * so a missing or misspelled setting fails loudly in one place instead of
 * surfacing later as `undefined` deep inside a feature. Bindings such as the
 * database are still taken from `env` by route handlers and passed down.
 */
import {z} from 'zod';

import {
  AppEnvironmentSchema,
  type AppEnvironment,
} from '@/shared/app_environment';
import {SentryDsnSchema} from '@/shared/monitoring';

/** The project and environment used for Worker error reporting. */
export interface WorkerMonitoringConfig {
  /** The configured ingestion address for this environment. */
  readonly dsn: string;
  /** The hosted environment associated with the event. */
  readonly environment: 'staging' | 'production';
}

/** Raw settings used only by the optional diagnostics integration. */
const RawMonitoringSettingsSchema = z.object({
  APP_ENV: z.enum(['staging', 'production']),
  SENTRY_DSN: SentryDsnSchema,
});

/**
 * Reads the optional hosted diagnostics settings. A missing or invalid DSN
 * leaves diagnostics disabled and never fails an application request.
 */
export function parseWorkerMonitoringConfig(
  env: unknown,
): WorkerMonitoringConfig | undefined {
  const parsed = RawMonitoringSettingsSchema.safeParse(env);
  return parsed.success
    ? {dsn: parsed.data.SENTRY_DSN, environment: parsed.data.APP_ENV}
    : undefined;
}

/** The settings the Worker needs, after validation. */
export interface WorkerConfig {
  /** Which environment this Worker is running in. */
  readonly appEnvironment: AppEnvironment;
  /**
   * Key for the Windy Webcams API, or `null` when none is set. Required in
   * staging and production. Locally it is optional: without it the Windy
   * import jobs skip, so tests and CI never call Windy.
   */
  readonly windyApiKey: string | null;
}

/** Environments that must have every secret set. */
const HOSTED_ENVIRONMENTS: ReadonlySet<AppEnvironment> = new Set([
  'staging',
  'production',
]);

/**
 * Shape of the raw settings in `env`. Unknown keys (including bindings like
 * `DB`) are ignored here.
 */
const RawWorkerSettingsSchema = z
  .object({
    APP_ENV: AppEnvironmentSchema,
    // An empty value (for example `WINDY_API_KEY=` copied from
    // .dev.vars.example) means "not set".
    WINDY_API_KEY: z
      .string()
      .optional()
      .transform(value => (value === undefined || value === '' ? null : value)),
  })
  .refine(
    settings =>
      settings.WINDY_API_KEY !== null ||
      !HOSTED_ENVIRONMENTS.has(settings.APP_ENV),
    {path: ['WINDY_API_KEY'], message: 'Required in hosted environments.'},
  );

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
 * config.windyApiKey; // the key, or null when not set locally
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
  return {
    appEnvironment: result.data.APP_ENV,
    windyApiKey: result.data.WINDY_API_KEY,
  };
}
