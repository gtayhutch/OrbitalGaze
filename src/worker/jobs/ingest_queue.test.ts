/**
 * @fileoverview Tests for the camera import queue consumer.
 *
 * Layer: worker tests (workerd with a real local D1). Windy is faked, and
 * each message records whether it was acknowledged or retried.
 */
import {env} from 'cloudflare:workers';
import {describe, expect, it} from 'vitest';

import {
  buildWindyWebcam,
  fakeFetch,
  fakeWindyPage,
  jsonResponse,
  type FakeFetch,
} from '../test_support/windy_fakes';
import {handleIngestBatch} from './ingest_queue';

/** What the consumer did with one message. */
type Outcome = 'pending' | 'ack' | 'retry';

/** A test message that records its outcome. */
interface RecordingMessage extends Message {
  outcome: Outcome;
}

/** Builds a message with `body` that records ack and retry calls. */
function recordingMessage(body: unknown): RecordingMessage {
  const message: RecordingMessage = {
    id: crypto.randomUUID(),
    timestamp: new Date(),
    body,
    attempts: 1,
    outcome: 'pending',
    ack() {
      message.outcome = 'ack';
    },
    retry() {
      message.outcome = 'retry';
    },
  };
  return message;
}

/** Runs the consumer on one message and returns what happened to it. */
async function consume(
  body: unknown,
  windy: FakeFetch,
  bindings: Env = {...env, WINDY_API_KEY: 'test-key'},
): Promise<Outcome> {
  const message = recordingMessage(body);
  const batch: MessageBatch = {
    queue: 'orbitalgaze-ingest-local',
    messages: [message],
    metadata: {metrics: {backlogCount: 1, backlogBytes: 0}},
    ackAll() {
      message.outcome = 'ack';
    },
    retryAll() {
      message.outcome = 'retry';
    },
  };
  await handleIngestBatch(batch, bindings, windy.fetch);
  return message.outcome;
}

/** A valid page request. */
const pageMessage = {kind: 'windy-page', runId: '2026-11-18', offset: 50};

describe('handleIngestBatch', () => {
  it('imports the page and acknowledges the message', async () => {
    const webcam = buildWindyWebcam();
    const windy = fakeWindyPage([webcam]);

    expect(await consume(pageMessage, windy)).toBe('ack');
    expect(windy.requests[0]?.url.searchParams.get('offset')).toBe('50');
    const stored = await env.DB.prepare('SELECT id FROM cameras WHERE id = ?')
      .bind(`windy-${webcam.webcamId}`)
      .first();
    expect(stored).not.toBeNull();
  });

  it('retries when Windy fails for a reason that may pass', async () => {
    expect(
      await consume(
        pageMessage,
        fakeFetch(() => jsonResponse({}, 503)),
      ),
    ).toBe('retry');
  });

  it('drops the message, without retrying, when Windy rejects the key', async () => {
    expect(
      await consume(
        pageMessage,
        fakeFetch(() => jsonResponse({}, 401)),
      ),
    ).toBe('ack');
  });

  it('drops malformed messages without calling Windy', async () => {
    const windy = fakeWindyPage([]);

    for (const body of [
      null,
      {kind: 'windy-page', runId: '2026-11-18', offset: 10_000},
      {kind: 'windy-page', runId: '2026-11-18', offset: 25},
      {kind: 'other', runId: '2026-11-18', offset: 0},
    ]) {
      expect(await consume(body, windy)).toBe('ack');
    }
    expect(windy.requests).toHaveLength(0);
  });

  it('skips the import without calling Windy when no key is set', async () => {
    const windy = fakeWindyPage([buildWindyWebcam()]);

    expect(await consume(pageMessage, windy, {...env, WINDY_API_KEY: ''})).toBe(
      'ack',
    );
    expect(windy.requests).toHaveLength(0);
  });
});
