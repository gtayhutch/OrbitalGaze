/**
 * @fileoverview Tests for the cron trigger handler.
 *
 * Layer: worker tests (workerd with real local D1 and R2). The queue
 * producer is replaced by a recorder so the messages can be inspected.
 */
import {createScheduledController} from 'cloudflare:test';
import {env} from 'cloudflare:workers';
import {describe, expect, it} from 'vitest';

import {CAMERA_INDEX_OBJECT_KEY, type IngestMessage} from '../features/cameras';
import {
  handleScheduled,
  IMPORT_FINALIZE_CRON,
  IMPORT_PLAN_CRON,
  type IngestQueueSender,
} from './scheduled';

/** A queue producer that records what it is sent. */
function recordingQueue(): IngestQueueSender & {batches: IngestMessage[][]} {
  const batches: IngestMessage[][] = [];
  return {
    batches,
    sendBatch(messages) {
      batches.push([...messages].map(message => message.body));
      return Promise.resolve();
    },
  };
}

/** The test bindings with a Windy key set. */
const envWithKey: Env = {...env, WINDY_API_KEY: 'test-key'};

/** The test bindings with no Windy key, as in CI. */
const envWithoutKey: Env = {...env, WINDY_API_KEY: ''};

describe('handleScheduled', () => {
  it('queues the nightly import in batches the queue accepts', async () => {
    const queue = recordingQueue();

    await handleScheduled(
      createScheduledController({
        cron: IMPORT_PLAN_CRON,
        scheduledTime: Date.parse('2026-11-18T03:00:00Z'),
      }),
      envWithKey,
      queue,
    );

    expect(queue.batches.map(batch => batch.length)).toEqual([100, 100]);
    expect(queue.batches.flat()[0]).toEqual({
      kind: 'windy-page',
      runId: '2026-11-18',
      offset: 0,
    });
  });

  it('queues nothing when no Windy key is set', async () => {
    const queue = recordingQueue();

    await handleScheduled(
      createScheduledController({cron: IMPORT_PLAN_CRON}),
      envWithoutKey,
      queue,
    );

    expect(queue.batches).toEqual([]);
  });

  it('builds the camera index file on the hourly run, with or without a key', async () => {
    await handleScheduled(
      createScheduledController({cron: IMPORT_FINALIZE_CRON}),
      envWithoutKey,
      recordingQueue(),
    );

    expect(await env.CAMERA_INDEX.head(CAMERA_INDEX_OBJECT_KEY)).not.toBeNull();
  });

  it('does nothing for a cron expression it does not know', async () => {
    const queue = recordingQueue();

    await handleScheduled(
      createScheduledController({cron: '0 0 1 1 *'}),
      envWithKey,
      queue,
    );

    expect(queue.batches).toEqual([]);
  });
});
