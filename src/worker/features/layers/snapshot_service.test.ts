/**
 * @fileoverview Tests for the snapshot refresh service.
 *
 * Layer: worker tests (workerd with a real local R2 bucket). Feeds are fake
 * (`snapshot_fakes.ts`), so no test reaches the internet. Each test uses its
 * own layer ID, because R2 is shared by the tests in this file.
 */
import {env} from 'cloudflare:workers';
import {describe, expect, it} from 'vitest';
import {z} from 'zod';

import {dataEnvelope} from '@/shared/api/envelope';
import {layerSnapshotSchema} from '@/shared/layers';

import {OutboundError} from '../../lib/outbound_fetch';
import {
  buildFakePoint,
  buildFakeSnapshotSource,
  fakeFeedFailing,
  fakeFeedServing,
  FakePointSchema,
} from '../../test_support/snapshot_fakes';
import {layerSnapshotKey} from './snapshot_repository';
import {
  describeRefreshFailure,
  isDue,
  refreshDueSnapshots,
  refreshSnapshot,
} from './snapshot_service';

/** The stored object's schema for fake layers. */
const StoredFakeSnapshotSchema = dataEnvelope(
  layerSnapshotSchema(FakePointSchema),
);

/** The scheduled time most tests use: 10:05 UTC, a 5-minute boundary. */
const TEN_OH_FIVE = new Date('2026-11-18T10:05:00Z');

/** Reads a layer's stored object as text, or null when there is none. */
async function storedText(layerId: string): Promise<string | null> {
  const object = await env.LAYER_SNAPSHOTS.get(layerSnapshotKey(layerId));
  return object === null ? null : object.text();
}

describe('isDue', () => {
  it.each([
    {refreshMinutes: 5, at: '10:05', due: true},
    {refreshMinutes: 15, at: '10:45', due: true},
    {refreshMinutes: 15, at: '10:50', due: false},
    {refreshMinutes: 60, at: '10:00', due: true},
    {refreshMinutes: 60, at: '10:30', due: false},
    {refreshMinutes: 240, at: '04:00', due: true},
    {refreshMinutes: 240, at: '05:00', due: false},
    {refreshMinutes: 1440, at: '00:00', due: true},
    {refreshMinutes: 1440, at: '12:00', due: false},
  ])(
    'is $due for a $refreshMinutes-minute layer at $at UTC',
    ({refreshMinutes, at, due}) => {
      expect(isDue({refreshMinutes}, new Date(`2026-11-18T${at}:00Z`))).toBe(
        due,
      );
    },
  );

  it('counts from midnight UTC, not from local time', () => {
    // 23:00 UTC is a whole hour in UTC even where local time is 18:30.
    expect(isDue({refreshMinutes: 60}, new Date('2026-11-18T23:00:00Z'))).toBe(
      true,
    );
  });
});

describe('refreshSnapshot', () => {
  it('stores the full API envelope as JSON', async () => {
    const source = buildFakeSnapshotSource();
    const points = [buildFakePoint({id: 'a'}), buildFakePoint({id: 'b'})];

    const result = await refreshSnapshot(source, {
      bucket: env.LAYER_SNAPSHOTS,
      now: TEN_OH_FIVE,
      fetch: fakeFeedServing(points).fetch,
    });

    expect(result).toEqual({
      layerId: source.id,
      items: 2,
      checkedAt: '2026-11-18T10:05:00.000Z',
    });
    const object = await env.LAYER_SNAPSHOTS.get(layerSnapshotKey(source.id));
    expect(object?.httpMetadata?.contentType).toBe(
      'application/json; charset=UTF-8',
    );
    const stored = StoredFakeSnapshotSchema.parse(await object?.json());
    expect(stored).toEqual({
      data: {
        layerId: source.id,
        checkedAt: '2026-11-18T10:05:00.000Z',
        items: points,
      },
    });
  });

  it("asks only the source's own feed, without following redirects", async () => {
    const source = buildFakeSnapshotSource();
    const feed = fakeFeedServing([]);

    await refreshSnapshot(source, {
      bucket: env.LAYER_SNAPSHOTS,
      now: TEN_OH_FIVE,
      fetch: feed.fetch,
    });

    expect(feed.requests.map(request => request.url.href)).toEqual([
      `https://feed.example.test/${source.id}.json`,
    ]);
    expect(feed.requests[0]?.redirect).toBe('manual');
  });

  it('keeps the previous snapshot when the feed fails', async () => {
    const source = buildFakeSnapshotSource();
    await refreshSnapshot(source, {
      bucket: env.LAYER_SNAPSHOTS,
      now: TEN_OH_FIVE,
      fetch: fakeFeedServing([buildFakePoint()]).fetch,
    });
    const before = await storedText(source.id);

    await expect(
      refreshSnapshot(source, {
        bucket: env.LAYER_SNAPSHOTS,
        now: new Date('2026-11-18T10:10:00Z'),
        fetch: fakeFeedFailing(503).fetch,
      }),
    ).rejects.toBeInstanceOf(OutboundError);

    expect(await storedText(source.id)).toBe(before);
  });

  it('keeps the previous snapshot when the feed sends invalid items', async () => {
    const source = buildFakeSnapshotSource();
    await refreshSnapshot(source, {
      bucket: env.LAYER_SNAPSHOTS,
      now: TEN_OH_FIVE,
      fetch: fakeFeedServing([buildFakePoint()]).fetch,
    });
    const before = await storedText(source.id);

    await expect(
      refreshSnapshot(source, {
        bucket: env.LAYER_SNAPSHOTS,
        now: new Date('2026-11-18T10:10:00Z'),
        fetch: fakeFeedServing([{id: 'x', lat: 'north', lng: 0}]).fetch,
      }),
    ).rejects.toBeInstanceOf(z.ZodError);

    expect(await storedText(source.id)).toBe(before);
  });

  it('writes nothing for a layer whose first refresh fails', async () => {
    const source = buildFakeSnapshotSource();

    await expect(
      refreshSnapshot(source, {
        bucket: env.LAYER_SNAPSHOTS,
        now: TEN_OH_FIVE,
        fetch: fakeFeedFailing(500).fetch,
      }),
    ).rejects.toThrow();

    expect(await storedText(source.id)).toBeNull();
  });
});

describe('refreshDueSnapshots', () => {
  it('refreshes only the layers due at this minute', async () => {
    const everyFive = buildFakeSnapshotSource({refreshMinutes: 5});
    const hourly = buildFakeSnapshotSource({refreshMinutes: 60});
    const feed = fakeFeedServing([buildFakePoint()]);

    const outcomes = await refreshDueSnapshots([everyFive, hourly], {
      bucket: env.LAYER_SNAPSHOTS,
      now: TEN_OH_FIVE,
      fetch: feed.fetch,
    });

    expect(outcomes.map(outcome => outcome.layerId)).toEqual([everyFive.id]);
    expect(feed.requests).toHaveLength(1);
    expect(await storedText(hourly.id)).toBeNull();
  });

  it('reports each layer, and one failure does not stop the others', async () => {
    const failing = buildFakeSnapshotSource();
    const working = buildFakeSnapshotSource();
    const feed = fakeFeedServing([buildFakePoint()]);
    // The failing layer's requests get a 502; the other's get the points.
    const failingFeed = fakeFeedFailing(502);
    const routedFetch: typeof feed.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      return url.includes(failing.id)
        ? failingFeed.fetch(input, init)
        : feed.fetch(input, init);
    };

    const outcomes = await refreshDueSnapshots([failing, working], {
      bucket: env.LAYER_SNAPSHOTS,
      now: TEN_OH_FIVE,
      fetch: routedFetch,
    });

    expect(outcomes).toEqual([
      {
        layerId: failing.id,
        items: null,
        durationMs: expect.any(Number) as number,
        failure: 'http-status',
        httpStatus: 502,
        errorName: null,
      },
      {
        layerId: working.id,
        items: 1,
        durationMs: expect.any(Number) as number,
        failure: null,
        httpStatus: null,
        errorName: null,
      },
    ]);
    expect(await storedText(working.id)).not.toBeNull();
  });

  it('returns nothing when no layer is due', async () => {
    const hourly = buildFakeSnapshotSource({refreshMinutes: 60});

    const outcomes = await refreshDueSnapshots([hourly], {
      bucket: env.LAYER_SNAPSHOTS,
      now: TEN_OH_FIVE,
      fetch: fakeFeedServing([]).fetch,
    });

    expect(outcomes).toEqual([]);
  });
});

describe('describeRefreshFailure', () => {
  it('keeps the kind and status of an outbound failure', () => {
    expect(
      describeRefreshFailure(
        new OutboundError('http-status', 'feed.example.test', 503),
      ),
    ).toEqual({failure: 'http-status', httpStatus: 503, errorName: null});
  });

  it('reports invalid feed data without its details', () => {
    const error = z.object({lat: z.number()}).safeParse({lat: 'x'}).error;

    expect(describeRefreshFailure(error)).toEqual({
      failure: 'invalid-data',
      httpStatus: null,
      errorName: null,
    });
  });

  it('reports anything else by class name only', () => {
    expect(
      describeRefreshFailure(new TypeError('the message is never logged')),
    ).toEqual({
      failure: 'unexpected',
      httpStatus: null,
      errorName: 'TypeError',
    });
  });
});
