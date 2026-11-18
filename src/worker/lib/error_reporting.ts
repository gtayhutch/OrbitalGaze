/**
 * @fileoverview Worker Sentry wiring and the reporting hook for handled 500s.
 *
 * The SDK keeps error events request scoped and hands their delivery to the
 * Worker's execution context. The existing structured logs remain available
 * whether or not Sentry is configured.
 */
import {
  captureException,
  getClient,
  withSentry,
  type CloudflareOptions,
} from '@sentry/cloudflare';

import {
  diagnosticDataCollection,
  monitoringRelease,
  scrubDiagnosticEvent,
} from '@/shared/monitoring';

import {parseWorkerMonitoringConfig} from './config';

/**
 * Wraps the Worker entry points so unhandled fetch, scheduled and queue
 * errors can be reported. With no hosted DSN, delivery is disabled.
 */
export function withWorkerErrorReporting<T extends ExportedHandler<Env>>(
  handler: T,
): T {
  return withSentry((env: unknown): CloudflareOptions => {
    const config = parseWorkerMonitoringConfig(env);
    if (config === undefined) {
      return {
        enabled: false,
        dsn: '',
        defaultIntegrations: false,
        cacheClient: false,
      };
    }
    const release = monitoringRelease();
    return {
      ...config,
      ...(release === undefined ? {} : {release}),
      defaultIntegrations: false,
      cacheClient: false,
      tracesSampleRate: 0,
      dataCollection: diagnosticDataCollection,
      sendClientReports: false,
      beforeSend: event =>
        scrubDiagnosticEvent(
          event,
          config.environment,
          release,
          'worker.handler',
        ),
    };
  }, handler);
}

/** Reports an unexpected API error that Hono has already caught. */
export function reportUnexpectedApiError(error: Error): void {
  if (getClient() !== undefined) {
    captureException(error, {tags: {signal: 'worker.api'}});
  }
}
