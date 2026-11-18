/**
 * @fileoverview Tests for the cron trigger handler.
 *
 * Layer: worker tests (workerd with real local D1 and R2). The queue
 * producer is replaced by a recorder so the messages can be inspected, the
 * snapshot layers are fakes with a fake feed, and log lines are captured
 * from the console, where the logger writes them.
 */
import {createScheduledController} from 'cloudflare:test';
import {env} from 'cloudflare:workers';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {CAMERA_INDEX_OBJECT_KEY, type IngestMessage} from '../features/cameras';
import {layerSnapshotKey} from '../features/layers';
import {
  buildFakePoint,
  buildFakeSnapshotSource,
  fakeFeedFailing,
  fakeFeedServing,
  UPSTREAM_MARKER,
} from '../test_support/snapshot_fakes';
import {
  DISPATCH_CRON,
  handleScheduled,
  IMPORT_FINALIZE_CRON,
  IMPORT_PLAN_CRON,
  LAYER_REFRESH_CRON,
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
  it('uses a single tick for the nightly import and its due snapshots', async () => {
    const queue = recordingQueue();
    const source = buildFakeSnapshotSource();
    const feed = fakeFeedServing([buildFakePoint()]);
    await handleScheduled(
      createScheduledController({
        cron: DISPATCH_CRON,
        scheduledTime: Date.parse('2026-11-19T03:00:00Z'),
      }),
      envWithKey,
      {queue, snapshotSources: [source], fetch: feed.fetch},
    );

    expect(queue.batches).toHaveLength(1);
    expect(queue.batches[0]).toHaveLength(21);
    expect(
      await env.LAYER_SNAPSHOTS.head(layerSnapshotKey(source.id)),
    ).not.toBeNull();
  });

  it('only rebuilds the camera index at minute :30', async () => {
    const queue = recordingQueue();
    const tick = (minute: string) =>
      createScheduledController({
        cron: DISPATCH_CRON,
        scheduledTime: Date.parse(`2026-11-19T04:${minute}:00Z`),
      });
    await handleScheduled(tick('25'), envWithKey, {queue});
    expect(await env.CAMERA_INDEX.head(CAMERA_INDEX_OBJECT_KEY)).toBeNull();

    await handleScheduled(tick('30'), envWithKey, {queue});
    expect(await env.CAMERA_INDEX.head(CAMERA_INDEX_OBJECT_KEY)).not.toBeNull();
    expect(queue.batches).toEqual([]);
  });

  it('queues the nightly import in batches the queue accepts', async () => {
    const queue = recordingQueue();

    await handleScheduled(
      createScheduledController({
        cron: IMPORT_PLAN_CRON,
        scheduledTime: Date.parse('2026-11-18T03:00:00Z'),
      }),
      envWithKey,
      {queue},
    );

    // 21 pages fit in one batch (the queue accepts up to 100 per call).
    expect(queue.batches.map(batch => batch.length)).toEqual([21]);
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
      {queue},
    );

    expect(queue.batches).toEqual([]);
  });

  it('builds the camera index file on the hourly run, with or without a key', async () => {
    await handleScheduled(
      createScheduledController({cron: IMPORT_FINALIZE_CRON}),
      envWithoutKey,
      {queue: recordingQueue()},
    );

    expect(await env.CAMERA_INDEX.head(CAMERA_INDEX_OBJECT_KEY)).not.toBeNull();
  });

  it('does nothing for a cron expression it does not know', async () => {
    const queue = recordingQueue();

    await handleScheduled(
      createScheduledController({cron: '0 0 1 1 *'}),
      envWithKey,
      {queue},
    );

    expect(queue.batches).toEqual([]);
  });
});

/** Log lines written during the current test, parsed from JSON. */
let logLines: Array<Record<string, unknown>> = [];

/** The raw text of every log line, to check what never appears in logs. */
let rawLogText = '';

describe('handleScheduled: layer refresh', () => {
  beforeEach(() => {
    logLines = [];
    rawLogText = '';
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      rawLogText += `${String(line)}
`;
      logLines.push(JSON.parse(String(line)) as Record<string, unknown>);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A refresh-cron event at `time` (UTC, `HH:MM`) on 2026-11-18. */
  function refreshAt(time: string): ScheduledController {
    return createScheduledController({
      cron: LAYER_REFRESH_CRON,
      scheduledTime: Date.parse(`2026-11-18T${time}:00Z`),
    });
  }

  /** Whether `layerId` has a stored snapshot. */
  async function hasSnapshot(layerId: string): Promise<boolean> {
    return (await env.LAYER_SNAPSHOTS.head(layerSnapshotKey(layerId))) !== null;
  }

  it('refreshes only the layers due at this minute', async () => {
    const everyFive = buildFakeSnapshotSource({refreshMinutes: 5});
    const hourly = buildFakeSnapshotSource({refreshMinutes: 60});
    const feed = fakeFeedServing([buildFakePoint()]);

    await handleScheduled(refreshAt('10:05'), env, {
      snapshotSources: [everyFive, hourly],
      fetch: feed.fetch,
    });

    expect(await hasSnapshot(everyFive.id)).toBe(true);
    expect(await hasSnapshot(hourly.id)).toBe(false);
    expect(feed.requests).toHaveLength(1);
  });

  it('refreshes every layer whose interval lines up', async () => {
    const everyFive = buildFakeSnapshotSource({refreshMinutes: 5});
    const hourly = buildFakeSnapshotSource({refreshMinutes: 60});

    await handleScheduled(refreshAt('11:00'), env, {
      snapshotSources: [everyFive, hourly],
      fetch: fakeFeedServing([buildFakePoint()]).fetch,
    });

    expect(await hasSnapshot(everyFive.id)).toBe(true);
    expect(await hasSnapshot(hourly.id)).toBe(true);
  });

  it('logs one line per layer with its count and duration', async () => {
    const source = buildFakeSnapshotSource();

    await handleScheduled(refreshAt('10:05'), env, {
      snapshotSources: [source],
      fetch: fakeFeedServing([buildFakePoint(), buildFakePoint()]).fetch,
    });

    expect(logLines).toEqual([
      expect.objectContaining({
        level: 'info',
        message: 'layer refreshed',
        cron: LAYER_REFRESH_CRON,
        layerId: source.id,
        items: 2,
        durationMs: expect.any(Number) as unknown,
        failure: null,
      }),
    ]);
  });

  it('keeps the old snapshot and logs the failure when a feed fails', async () => {
    const source = buildFakeSnapshotSource();
    await handleScheduled(refreshAt('10:05'), env, {
      snapshotSources: [source],
      fetch: fakeFeedServing([buildFakePoint()]).fetch,
    });
    const key = layerSnapshotKey(source.id);
    const before = await (await env.LAYER_SNAPSHOTS.get(key))?.text();
    logLines = [];

    await handleScheduled(refreshAt('10:10'), env, {
      snapshotSources: [source],
      fetch: fakeFeedFailing(503).fetch,
    });

    expect(await (await env.LAYER_SNAPSHOTS.get(key))?.text()).toBe(before);
    expect(logLines).toEqual([
      expect.objectContaining({
        level: 'error',
        message: 'layer refresh failed',
        layerId: source.id,
        items: null,
        failure: 'http-status',
        httpStatus: 503,
      }),
    ]);
  });

  it('never writes what a feed sent into the logs', async () => {
    const source = buildFakeSnapshotSource();

    await handleScheduled(refreshAt('10:05'), env, {
      snapshotSources: [source],
      // Valid JSON with an invalid point whose ID is the marker.
      fetch: fakeFeedServing([{id: UPSTREAM_MARKER, lat: 'north', lng: 0}])
        .fetch,
    });

    expect(logLines).toEqual([
      expect.objectContaining({failure: 'invalid-data', layerId: source.id}),
    ]);
    expect(rawLogText).not.toContain(UPSTREAM_MARKER);
  });

  it('logs once when no layer is due', async () => {
    const hourly = buildFakeSnapshotSource({refreshMinutes: 60});
    const feed = fakeFeedServing([]);

    await handleScheduled(refreshAt('10:05'), env, {
      snapshotSources: [hourly],
      fetch: feed.fetch,
    });

    expect(feed.requests).toEqual([]);
    expect(logLines).toEqual([
      expect.objectContaining({message: 'layer refresh: no layers due'}),
    ]);
  });

  it('has a defined outcome with an empty layer list', async () => {
    await handleScheduled(refreshAt('10:05'), env, {snapshotSources: []});

    expect(logLines).toEqual([
      expect.objectContaining({message: 'layer refresh: no layers due'}),
    ]);
  });
});
