/**
 * @fileoverview Handler for the Worker's cron triggers.
 *
 * Layer: worker job (server only). Called from `scheduled` in `index.ts`.
 *
 * Kept thin: it reads the bindings and settings, picks the job for the cron
 * expression that fired, and calls a feature service. The cron expressions
 * must match `triggers.crons` in `wrangler.jsonc`.
 *
 * - {@link IMPORT_PLAN_CRON} (03:00 UTC daily): queues the Windy import, one
 *   message per page. Skipped when no Windy key is set.
 * - {@link IMPORT_FINALIZE_CRON} (hourly at :30): marks cameras Windy
 *   stopped listing as offline and rebuilds the camera index file.
 * - {@link LAYER_REFRESH_CRON} (every five minutes): refreshes the snapshot
 *   layers that are due at this minute, and logs one line per layer.
 *
 * The new dispatcher uses one trigger and starts each due job independently.
 * Legacy expressions remain recognized while Cloudflare applies the change.
 */
import {
  createCameraRepository,
  finalizeImport,
  planWindyImport,
  type IngestMessage,
} from '../features/cameras';
import {
  refreshDueSnapshots,
  SNAPSHOT_SOURCES,
  type SnapshotSource,
} from '../features/layers';
import {parseWorkerConfig} from '../lib/config';
import {createLogger, type Logger} from '../lib/logger';
import type {FetchFunction} from '../lib/outbound_fetch';

/** Cron expression for planning the nightly import. */
export const IMPORT_PLAN_CRON = '0 3 * * *';

/** Cron expression for the hourly finish step. */
export const IMPORT_FINALIZE_CRON = '30 * * * *';

/**
 * Cron expression for the snapshot layer refresh: every five minutes, the
 * shortest interval a layer may ask for (`REFRESH_STEP_MINUTES`).
 */
export const LAYER_REFRESH_CRON = '*/5 * * * *';

/**
 * Every five minutes, spelled distinctly from the previous snapshot-only
 * trigger so it can still be recognized during schedule propagation.
 */
export const DISPATCH_CRON = '0-55/5 * * * *';

/** UTC hour of the daily camera import, with no local time change. */
const IMPORT_HOUR_UTC = 3;

/** Minute of the hour for updating the camera index. */
const FINALIZE_MINUTE_UTC = 30;

/** Most messages one `sendBatch` call accepts. */
const QUEUE_SEND_BATCH_LIMIT = 100;

/** Where a producer sends import messages; the queue binding in production. */
export interface IngestQueueSender {
  sendBatch(messages: Iterable<{body: IngestMessage}>): Promise<unknown>;
}

/**
 * Queues one message per Windy page.
 *
 * @param queue The import queue.
 * @param now When the run starts.
 * @param logger Logger for the job.
 */
async function planImport(
  queue: IngestQueueSender,
  now: Date,
  logger: Logger,
): Promise<void> {
  const messages = planWindyImport(now);
  // Queues accept at most 100 messages per call.
  for (
    let start = 0;
    start < messages.length;
    start += QUEUE_SEND_BATCH_LIMIT
  ) {
    const chunk = messages.slice(start, start + QUEUE_SEND_BATCH_LIMIT);
    await queue.sendBatch(chunk.map(body => ({body})));
  }
  logger.info('import planned', {pages: messages.length});
}

/**
 * Refreshes the snapshot layers due at `now` and logs one line per layer.
 *
 * The log carries the layer, the item count, the duration, and a failure
 * kind, never anything the feed sent. A failed layer keeps its previous
 * snapshot and is retried at its next scheduled minute.
 *
 * @param sources The snapshot layers.
 * @param bucket The `LAYER_SNAPSHOTS` bucket.
 * @param now The cron's scheduled time.
 * @param fetchForSources The `fetch` the sources use.
 * @param logger Logger for the job.
 */
async function refreshLayers(
  sources: readonly SnapshotSource[],
  bucket: R2Bucket,
  now: Date,
  fetchForSources: FetchFunction,
  logger: Logger,
): Promise<void> {
  const outcomes = await refreshDueSnapshots(sources, {
    bucket,
    now,
    fetch: fetchForSources,
  });
  if (outcomes.length === 0) {
    logger.info('layer refresh: no layers due');
    return;
  }
  for (const outcome of outcomes) {
    const fields = {
      layerId: outcome.layerId,
      items: outcome.items,
      durationMs: outcome.durationMs,
      failure: outcome.failure,
      httpStatus: outcome.httpStatus,
      errorName: outcome.errorName,
    };
    if (outcome.failure === null) {
      logger.info('layer refreshed', fields);
    } else {
      logger.error('layer refresh failed', fields);
    }
  }
}

/** Replaceable dependencies of {@link handleScheduled}; tests set them. */
export interface ScheduledDependencies {
  /** Where to send import messages. Defaults to `env.INGEST_QUEUE`. */
  readonly queue?: IngestQueueSender;
  /** The snapshot layers to refresh. Defaults to `SNAPSHOT_SOURCES`. */
  readonly snapshotSources?: readonly SnapshotSource[];
  /** The `fetch` snapshot sources use. Defaults to the runtime's. */
  readonly fetch?: FetchFunction;
}

/**
 * Runs the job for the cron expression that fired.
 *
 * @param controller The scheduled event (cron expression and time).
 * @param env The Worker's bindings and settings.
 * @param deps Test replacements for the queue, the layers, and `fetch`;
 *     production passes none.
 * @example
 * // In index.ts:
 * scheduled: (controller, env) => handleScheduled(controller, env),
 */
export async function handleScheduled(
  controller: ScheduledController,
  env: Env,
  deps: ScheduledDependencies = {},
): Promise<void> {
  const logger = createLogger({job: 'scheduled', cron: controller.cron});
  const config = parseWorkerConfig(env);
  const now = new Date(controller.scheduledTime);

  /** Queues the import only when this environment has a Windy key. */
  const runImport = async (): Promise<void> => {
    if (config.windyApiKey === null) {
      logger.info('import skipped: no Windy API key is set');
      return;
    }
    await planImport(deps.queue ?? env.INGEST_QUEUE, now, logger);
  };

  /** Rebuilds the camera index and records whether it changed. */
  const runFinalize = async (): Promise<void> => {
    const result = await finalizeImport({
      cameras: createCameraRepository(env.DB),
      bucket: env.CAMERA_INDEX,
      now,
    });
    logger.info('import finalized', {
      markedOffline: result.markedOffline,
      indexedCameras: result.indexedCameras,
      indexWritten: result.indexWritten,
    });
  };

  const snapshotSources = deps.snapshotSources ?? SNAPSHOT_SOURCES;
  /** Checks which snapshot sources are due and refreshes them. */
  const runSnapshots = (): Promise<void> =>
    refreshLayers(
      snapshotSources,
      env.LAYER_SNAPSHOTS,
      now,
      deps.fetch ?? fetch,
      logger,
    );

  switch (controller.cron) {
    case DISPATCH_CRON: {
      // Cloudflare supplies the scheduled time even if execution starts late.
      const minute = now.getUTCMinutes();
      const jobs: Promise<void>[] = [];
      if (now.getUTCHours() === IMPORT_HOUR_UTC && minute === 0) {
        jobs.push(runImport());
      }
      if (minute === FINALIZE_MINUTE_UTC) {
        jobs.push(runFinalize());
      }
      if (snapshotSources.length > 0) {
        jobs.push(runSnapshots());
      }

      // Let all due work finish before propagating an unexpected failure.
      const results = await Promise.allSettled(jobs);
      const failures = results.flatMap(result =>
        result.status === 'rejected' ? [result.reason as unknown] : [],
      );
      if (failures.length > 0) {
        throw new AggregateError(failures, 'A scheduled job failed.');
      }
      return;
    }
    case IMPORT_PLAN_CRON:
      return runImport();
    case IMPORT_FINALIZE_CRON:
      return runFinalize();
    case LAYER_REFRESH_CRON:
      return runSnapshots();
    default:
      // A cron in wrangler.jsonc with no job here is a configuration mistake.
      logger.error('no job for this cron expression');
  }
}
