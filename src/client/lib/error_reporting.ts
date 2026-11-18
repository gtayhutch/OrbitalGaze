/**
 * @fileoverview Reports browser errors through the optional Sentry SDK.
 *
 * The SDK is imported only in a configured hosted build and only after a
 * reportable error. The normal globe startup does not load its bundle.
 */
import {
  diagnosticDataCollection,
  monitoringRelease,
  scrubDiagnosticEvent,
  type MonitoringSignal,
} from '@/shared/monitoring';

import {parseBrowserMonitoringConfig} from './config';

/** The browser SDK initialization, shared by reports in this page visit. */
let sdkReady: Promise<typeof import('@sentry/browser')> | undefined;

/**
 * Reports a caught browser error if diagnostics are configured.
 *
 * @param signal A fixed category for grouping errors in Sentry.
 * @param error The original failure. A scrubber filters it before sending.
 */
export function reportBrowserError(
  signal: MonitoringSignal,
  error: unknown,
): void {
  const config = parseBrowserMonitoringConfig();
  if (config === undefined) {
    return;
  }
  const release = monitoringRelease();
  sdkReady ??= import('@sentry/browser').then(sdk => {
    sdk.init({
      ...config,
      ...(release === undefined ? {} : {release}),
      defaultIntegrations: false,
      dataCollection: diagnosticDataCollection,
      sendClientReports: false,
      beforeSend: event =>
        scrubDiagnosticEvent(
          event,
          config.environment,
          release,
          'browser.unhandled',
        ),
    });
    return sdk;
  });
  void sdkReady
    .then(sdk => sdk.captureException(error, {tags: {signal}}))
    .catch(() => {
      sdkReady = undefined;
      console.warn('Browser error reporting is unavailable.');
    });
}
