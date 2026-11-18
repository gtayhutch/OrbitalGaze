/**
 * @fileoverview Consumer for the camera import queue.
 *
 * Layer: worker job (server only). Called from `queue` in `index.ts`.
 *
 * Each message asks for one page of Windy webcams. Messages are handled one
 * at a time, and each is acknowledged or retried on its own, so one bad
 * page doesn't redo the others:
 * - success: acknowledged;
 * - a malformed message: logged and dropped (retrying can't fix it);
 * - Windy rejects the key (401/403): logged as an error and dropped, so a
 *   bad key doesn't loop through retries;
 * - any other failure (timeout, Windy error): retried after a minute, up to
 *   the queue's `max_retries`, then dropped with the failures logged.
 *
 * Importing a page twice is harmless, because cameras are upserted.
 */
import {
  createCameraRepository,
  createWindyClient,
  importWindyPage,
  IngestMessageSchema,
  isWindyKeyRejected,
} from '../features/cameras';
import {parseWorkerConfig} from '../lib/config';
import {createLogger} from '../lib/logger';
import {OutboundError, type FetchFunction} from '../lib/outbound_fetch';

/** Wait this long before retrying a failed page. */
const RETRY_DELAY_SECONDS = 60;

/**
 * Handles one batch of import messages.
 *
 * @param batch The messages.
 * @param env The Worker's bindings and settings.
 * @param fetchForWindy The `fetch` used to call Windy; tests pass a fake.
 * @example
 * // In index.ts:
 * queue: (batch, env) => handleIngestBatch(batch, env),
 */
export async function handleIngestBatch(
  batch: MessageBatch,
  env: Env,
  fetchForWindy?: FetchFunction,
): Promise<void> {
  const logger = createLogger({job: 'ingest', queue: batch.queue});
  const config = parseWorkerConfig(env);
  const cameras = createCameraRepository(env.DB);
  const windy =
    config.windyApiKey === null
      ? null
      : createWindyClient({apiKey: config.windyApiKey, fetch: fetchForWindy});

  for (const message of batch.messages) {
    // Step 1: messages are input too; validate before use.
    const parsed = IngestMessageSchema.safeParse(message.body);
    if (!parsed.success) {
      logger.error('dropped a malformed import message', {
        messageId: message.id,
      });
      message.ack();
      continue;
    }
    const {runId, offset} = parsed.data;
    if (windy === null) {
      logger.info('import skipped: no Windy API key is set', {runId, offset});
      message.ack();
      continue;
    }

    // Step 2: import the page, then acknowledge or retry it.
    try {
      const result = await importWindyPage(
        {windy, cameras, now: new Date()},
        parsed.data,
      );
      logger.info('imported a page', {runId, offset, ...result});
      message.ack();
    } catch (error) {
      if (isWindyKeyRejected(error)) {
        logger.error('Windy rejected the API key; page dropped', {
          runId,
          offset,
        });
        message.ack();
        continue;
      }
      // Log what failed without the error's full text, which could include
      // upstream content.
      logger.warn('page import failed; will retry', {
        runId,
        offset,
        attempt: message.attempts,
        failure:
          error instanceof OutboundError
            ? error.failure
            : error instanceof Error
              ? error.name
              : 'unknown',
        status: error instanceof OutboundError ? error.status : null,
      });
      message.retry({delaySeconds: RETRY_DELAY_SECONDS});
    }
  }
}
