/**
 * @fileoverview Configuration and privacy boundary shared by both Sentry SDKs.
 *
 * Event payloads are rebuilt from a short list of safe fields. Error
 * messages, request details, user IDs, breadcrumbs and arbitrary stack paths
 * can contain private data, so they never cross this boundary.
 */
import {z} from 'zod';

/** Commit SHA injected by the Vite build in Workers Builds. */
declare const ORBITALGAZE_DEPLOY_REVISION: string;

/** The content of a hosted project DSN, with no password or custom host. */
export const SentryDsnSchema = z
  .string()
  .regex(
    /^https:\/\/[0-9a-f]{32}@o\d+\.ingest(?:\.(?:us|de))?\.sentry\.io\/\d+$/,
  );

/** Disables collection of personal and request data in both SDKs. */
export const diagnosticDataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
};

/** Fixed issue categories used by the browser and Worker. */
const SignalSchema = z.enum([
  'browser.app-render',
  'browser.globe-start',
  'browser.globe-render',
  'browser.unhandled',
  'worker.api',
  'worker.handler',
]);

/** Issue category, which never contains text from a caught error. */
export type MonitoringSignal = z.infer<typeof SignalSchema>;

/** The SDK frame fields eligible to leave the app. */
interface SafeFrame {
  /** File name. Kept only when it matches a bundled application asset. */
  filename?: string;
  /** Generated source line. */
  lineno?: number;
  /** Generated source column. */
  colno?: number;
}

/** Subset of SDK fields used by the scrubber. */
interface DiagnosticEvent {
  /** SDK-generated random event ID. */
  event_id?: string;
  /** Time the SDK captured the event. */
  timestamp?: number;
  /** Stack from the caught error, before filtering. */
  exception?: {values?: Array<{stacktrace?: {frames?: SafeFrame[]}}>};
  /** Internal signal tag. */
  tags?: Record<string, unknown>;
}

/** Reads the build commit when running in a deployed build. */
export function monitoringRelease(): string | undefined {
  if (
    typeof ORBITALGAZE_DEPLOY_REVISION === 'string' &&
    /^[a-f0-9]{40}$/.test(ORBITALGAZE_DEPLOY_REVISION)
  ) {
    return ORBITALGAZE_DEPLOY_REVISION;
  }
  return undefined;
}

/**
 * Keeps only generated OrbitalGaze bundle names and line information. URL
 * origins, paths, queries, function names and all other frame fields drop.
 */
function safeFrames(frames: SafeFrame[]): SafeFrame[] {
  return frames.slice(-30).flatMap(frame => {
    const path = frame.filename?.split(/[?#]/, 1)[0] ?? '';
    const filename =
      /(?:^|\/)(index\.js|(?:index|globe)-[a-z\d_-]{6,32}\.js)$/i.exec(
        path,
      )?.[1];
    if (filename === undefined) {
      return [];
    }
    return [
      {
        filename,
        ...(frame.lineno === undefined ? {} : {lineno: frame.lineno}),
        ...(frame.colno === undefined ? {} : {colno: frame.colno}),
      },
    ];
  });
}

/**
 * Reconstructs a diagnostic event from the SDK's input. Pass the configured
 * environment and release rather than trusting event-supplied values.
 *
 * @example
 * beforeSend: event => scrubDiagnosticEvent(event, 'staging', release, 'worker.handler')
 */
export function scrubDiagnosticEvent(
  event: DiagnosticEvent,
  environment: 'staging' | 'production',
  release: string | undefined,
  fallbackSignal: MonitoringSignal,
) {
  const signal = SignalSchema.safeParse(event.tags?.['signal']);
  const category = signal.success ? signal.data : fallbackSignal;
  const frames = safeFrames(
    event.exception?.values?.at(-1)?.stacktrace?.frames ?? [],
  );
  return {
    ...(event.event_id === undefined ? {} : {event_id: event.event_id}),
    ...(event.timestamp === undefined ? {} : {timestamp: event.timestamp}),
    type: undefined,
    platform: 'javascript',
    level: 'error' as const,
    environment,
    ...(release === undefined ? {} : {release}),
    tags: {signal: category},
    fingerprint: [category],
    exception: {
      values: [
        {type: 'ApplicationError', value: category, stacktrace: {frames}},
      ],
    },
  };
}
