/**
 * @fileoverview Tests for `GET /api/v1/layers/:id`.
 *
 * Layer: worker tests (workerd with a real local R2 bucket and cache).
 *
 * The registry has no real layers yet, so most tests build the app with fake
 * layers (`createApp({snapshotSources})`); requests still go through the full
 * middleware chain. Cloudflare's cache is shared by the tests in this file,
 * so each test uses its own layer ID to start from a cache miss.
 */
import {env} from 'cloudflare:workers';
import {describe, expect, it} from 'vitest';

import {ApiErrorResponseSchema} from '@/shared/api/api_error';
import {dataEnvelope} from '@/shared/api/envelope';
import {layerSnapshotSchema} from '@/shared/layers';

import {createApp} from '../../app';
import {buildWorkerConfig} from '../../test_support/factories';
import {getPath} from '../../test_support/send_request';
import {
  buildFakePoint,
  buildFakeSnapshotSource,
  fakeFeedServing,
  FakePointSchema,
} from '../../test_support/snapshot_fakes';
import {refreshSnapshot} from './snapshot_service';

/** A fake layer with a snapshot, refreshed every 5 minutes, cached 4. */
const stocked = buildFakeSnapshotSource({maxAgeSeconds: 240});

/** A fake layer used to check the cached copy. */
const cachedLayer = buildFakeSnapshotSource();

/** A registered fake layer that never gets a snapshot. */
const empty = buildFakeSnapshotSource();

/** The app with the fake layers registered. */
const app = createApp({snapshotSources: [stocked, cachedLayer, empty]});

/** Requests a layer from the app with fake layers. */
async function getLayer(id: string): Promise<Response> {
  return getPath(`/api/v1/layers/${id}`, {}, env, app.fetch);
}

/** Stores a snapshot of `points` for `source`, as the refresh job would. */
async function storeSnapshot(
  source: typeof stocked,
  points: ReturnType<typeof buildFakePoint>[],
): Promise<void> {
  await refreshSnapshot(source, {
    bucket: env.LAYER_SNAPSHOTS,
    config: buildWorkerConfig(),
    now: new Date('2026-11-18T10:05:00Z'),
    fetch: fakeFeedServing(points).fetch,
  });
}

describe('GET /api/v1/layers/:id', () => {
  it("serves the stored snapshot, cacheable for the layer's max age", async () => {
    const points = [buildFakePoint({id: 'quake-1'})];
    await storeSnapshot(stocked, points);

    const response = await getLayer(stocked.id);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=240');
    expect(response.headers.get('Content-Type')).toBe(
      'application/json; charset=UTF-8',
    );
    const {data} = dataEnvelope(layerSnapshotSchema(FakePointSchema)).parse(
      await response.json(),
    );
    expect(data).toEqual({
      layerId: stocked.id,
      checkedAt: '2026-11-18T10:05:00.000Z',
      items: points,
    });
  });

  it('serves the cached copy until it expires, even if storage changed', async () => {
    await storeSnapshot(cachedLayer, [buildFakePoint({id: 'first'})]);
    const first = await getLayer(cachedLayer.id);
    const firstBody = await first.text();

    // A newer snapshot lands in R2; the edge copy is still within its age.
    await storeSnapshot(cachedLayer, [buildFakePoint({id: 'second'})]);
    const second = await getLayer(cachedLayer.id);

    expect(second.status).toBe(200);
    expect(second.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(await second.text()).toBe(firstBody);
  });

  it('answers 404 for a registered layer with no snapshot yet', async () => {
    const response = await getLayer(empty.id);

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const {error} = ApiErrorResponseSchema.parse(await response.json());
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe("This layer isn't available yet.");
  });

  it('answers 404 for a well-formed ID that is not a layer', async () => {
    const response = await getLayer('no-such-layer');

    expect(response.status).toBe(404);
    const {error} = ApiErrorResponseSchema.parse(await response.json());
    expect(error.code).toBe('NOT_FOUND');
  });

  it('answers 404 on the real app, which has no layers yet', async () => {
    const response = await getPath(`/api/v1/layers/${stocked.id}`);

    expect(response.status).toBe(404);
  });

  it('answers 400 for a malformed ID', async () => {
    for (const id of ['Earthquakes', 'has_underscore', 'a'.repeat(41)]) {
      const response = await getLayer(id);

      expect(response.status).toBe(400);
      const {error} = ApiErrorResponseSchema.parse(await response.json());
      expect(error.code).toBe('INVALID_INPUT');
    }
  });
});
