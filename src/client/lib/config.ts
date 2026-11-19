/**
 * @fileoverview Validated browser configuration.
 *
 * Layer: client library (browser only).
 *
 * This is the only client module that reads `import.meta.env`. Vite copies
 * variables whose names start with `VITE_` into the browser bundle, where
 * anyone can read them, so they may hold only public values. The browser
 * error-reporting address (DSN) qualifies: it only accepts reports.
 */
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
