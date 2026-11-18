/**
 * @fileoverview Fake snapshot layers and feeds for tests.
 *
 * Layer: worker test support (runs inside workerd during `pnpm test` only).
 *
 * The registry has no real layers yet, so tests build fake ones here. A fake
 * source behaves like a real one: it requests a fixed https URL through
 * `fetchJson` with an allowlist, validates the JSON with Zod, and returns the
 * items. Tests answer those requests with `fakeFetch` from `windy_fakes.ts`,
 * so no test reaches the internet.
 */
import {z} from 'zod';

import type {SnapshotSource} from '../features/layers';
import {fetchJson} from '../lib/outbound_fetch';
import {fakeFetch, jsonResponse, type FakeFetch} from './windy_fakes';

/** The only host fake sources call. `.test` never resolves on the internet. */
export const FAKE_FEED_HOST = 'feed.example.test';

/** Text in fake feed responses; it must never appear in a log line. */
export const UPSTREAM_MARKER = 'upstream-says-something-secret';

/** One item of a fake layer: a point with an ID. */
export const FakePointSchema = z.object({
  id: z.string(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/** A validated fake item. */
export type FakePoint = z.infer<typeof FakePointSchema>;

/** The fake feed's response body. */
const FakeFeedSchema = z.object({points: z.array(FakePointSchema)});

/** Counter that keeps generated layer IDs unique within a test file. */
let nextLayerNumber = 1;

/**
 * Builds a fake snapshot source that reads
 * `https://feed.example.test/<id>.json`.
 *
 * @param overrides Schedule, cache lifetime, or ID to change. By default a
 *     unique ID, a 5-minute refresh, and a 5-minute cache lifetime.
 * @returns The source.
 * @example
 * const hourly = buildFakeSnapshotSource({refreshMinutes: 60});
 */
export function buildFakeSnapshotSource(
  overrides: Partial<
    Pick<SnapshotSource, 'id' | 'refreshMinutes' | 'maxAgeSeconds'>
  > = {},
): SnapshotSource<FakePoint> {
  const id = overrides.id ?? `test-layer-${nextLayerNumber++}`;
  return {
    id,
    refreshMinutes: overrides.refreshMinutes ?? 5,
    maxAgeSeconds: overrides.maxAgeSeconds ?? 300,
    async fetchItems({fetch}) {
      const body = await fetchJson(
        new URL(`https://${FAKE_FEED_HOST}/${id}.json`),
        {
          allowedHosts: [FAKE_FEED_HOST],
          timeoutMs: 5_000,
          maxBytes: 100_000,
          fetch,
        },
      );
      return FakeFeedSchema.parse(body).points;
    },
  };
}

/**
 * Builds a fake point with sensible defaults (Tokyo).
 *
 * @param overrides Fields to change.
 * @returns The point.
 */
export function buildFakePoint(overrides: Partial<FakePoint> = {}): FakePoint {
  return {id: 'point-1', lat: 35.68, lng: 139.77, ...overrides};
}

/**
 * Creates a fake feed that serves `points` to every fake source.
 *
 * @param points The points to serve (or any values, to test validation).
 * @returns The fake `fetch` and its request log.
 */
export function fakeFeedServing(points: readonly unknown[]): FakeFetch {
  return fakeFetch(() => jsonResponse({points}));
}

/**
 * Creates a fake feed that fails every request with `status`. The body holds
 * a recognizable marker so tests can check it never reaches the logs.
 *
 * @param status The HTTP status to answer with.
 * @returns The fake `fetch` and its request log.
 */
export function fakeFeedFailing(status: number): FakeFetch {
  return fakeFetch(() => jsonResponse({message: UPSTREAM_MARKER}, status));
}
