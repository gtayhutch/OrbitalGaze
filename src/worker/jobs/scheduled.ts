/**
 * @fileoverview Handler for the Worker's cron triggers.
 *
 * Layer: worker job (server only). Called from `scheduled` in `index.ts`.
 *
 * Kept thin: it reads the bindings and settings, picks the job for the cron
 * expression that fired, and calls the cameras feature's import service.
 * The cron expressions must match `triggers.crons` in `wrangler.jsonc`.
 *
 * - {@link IMPORT_PLAN_CRON} (03:00 UTC daily): queues the Windy import, one
 *   message per page. Skipped when no Windy key is set.
 * - {@link IMPORT_FINALIZE_CRON} (hourly at :30): marks cameras Windy
 *   stopped listing as offline and rebuilds the camera index file.
 */
import {
  createCameraRepository,
  finalizeImport,
  planWindyImport,
  type IngestMessage,
} from '../features/cameras';
import {parseWorkerConfig} from '../lib/config';
import {createLogger, type Logger} from '../lib/logger';

/** Cron expression for planning the nightly import. */
export const IMPORT_PLAN_CRON = '0 3 * * *';

/** Cron expression for the hourly finish step. */
export const IMPORT_FINALIZE_CRON = '30 * * * *';

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
 * Runs the job for the cron expression that fired.
 *
 * @param controller The scheduled event (cron expression and time).
 * @param env The Worker's bindings and settings.
 * @param queue Where to send import messages. Defaults to `env.INGEST_QUEUE`;
 *     tests pass a recorder.
 * @example
 * // In index.ts:
 * scheduled: (controller, env) => handleScheduled(controller, env),
 */
export async function handleScheduled(
  controller: ScheduledController,
  env: Env,
  queue: IngestQueueSender = env.INGEST_QUEUE,
): Promise<void> {
  const logger = createLogger({job: 'scheduled', cron: controller.cron});
  const config = parseWorkerConfig(env);
  const now = new Date(controller.scheduledTime);

  switch (controller.cron) {
    case IMPORT_PLAN_CRON: {
      if (config.windyApiKey === null) {
        logger.info('import skipped: no Windy API key is set');
        return;
      }
      await planImport(queue, now, logger);
      return;
    }
    case IMPORT_FINALIZE_CRON: {
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
      return;
    }
    default:
      // A cron in wrangler.jsonc with no job here is a configuration mistake.
      logger.error('no job for this cron expression');
  }
}
