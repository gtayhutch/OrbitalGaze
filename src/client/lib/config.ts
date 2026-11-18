/**
 * @fileoverview Validated browser configuration.
 *
 * Layer: client library (browser only).
 *
 * This is the only client module that reads `import.meta.env`. Vite copies
 * variables whose names start with `VITE_` into the browser bundle, where
 * anyone can read them, so they may hold only public values. The Cesium ion
 * token qualifies because it is restricted to our own site's URLs in the
 * Cesium ion dashboard.
 */
import {z} from 'zod';

import {SentryDsnSchema} from '@/shared/monitoring';

/** Environment selected by the deploy build, with a local default. */
declare const ORBITALGAZE_BUILD_ENVIRONMENT: string;

/** Optional settings needed to initialize browser diagnostics. */
export interface BrowserMonitoringConfig {
  /** Public ingestion address of this environment's browser project. */
  readonly dsn: string;
  /** The hosted environment associated with the event. */
  readonly environment: 'staging' | 'production';
}

/**
 * Enables browser diagnostics only for hosted builds with a valid project DSN.
 * A missing or invalid DSN does not stop the app from loading.
 */
export function parseBrowserMonitoringConfig():
  BrowserMonitoringConfig | undefined {
  const environment =
    typeof ORBITALGAZE_BUILD_ENVIRONMENT === 'string'
      ? ORBITALGAZE_BUILD_ENVIRONMENT
      : 'test';
  const dsn = SentryDsnSchema.safeParse(import.meta.env['VITE_SENTRY_DSN']);
  if (
    !dsn.success ||
    (environment !== 'staging' && environment !== 'production')
  ) {
    return undefined;
  }
  return {dsn: dsn.data, environment};
}

/** Settings the browser app needs. */
export interface ClientConfig {
  /**
   * Cesium ion access token for satellite imagery. Absent when not
   * configured, in which case the globe uses the low-resolution imagery
   * bundled with Cesium, which needs no network access.
   */
  readonly cesiumIonToken: string | undefined;
}

/** Shape of the raw `VITE_*` variables. Empty strings count as unset. */
const RawClientSettingsSchema = z.object({
  VITE_CESIUM_ION_TOKEN: z
    .string()
    .optional()
    .transform(value => (value === '' ? undefined : value)),
});

/**
 * Reads and validates the browser app's settings.
 *
 * @param rawSettings The variables to read; defaults to Vite's `import.meta.env`.
 * @returns The typed configuration.
 * @throws {Error} If a variable has an unexpected type. This means the build
 *     was misconfigured.
 * @example
 * const {cesiumIonToken} = parseClientConfig();
 */
export function parseClientConfig(
  rawSettings: unknown = import.meta.env,
): ClientConfig {
  const settings = RawClientSettingsSchema.parse(rawSettings);
  return {cesiumIonToken: settings.VITE_CESIUM_ION_TOKEN};
}
