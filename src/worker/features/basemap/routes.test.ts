/**
 * @fileoverview Tests for the basemap TileJSON and tile routes.
 *
 * Layer: worker tests (workerd with a real local R2 bucket and cache).
 *
 * Each test stores its own small archive under its own key and points the
 * Worker at it through `BASEMAP_ARCHIVE`, so cached copies never leak
 * between tests (the cache key includes the archive version).
 */
import {env} from 'cloudflare:workers';
import {describe, expect, it} from 'vitest';

import {ApiErrorResponseSchema} from '@/shared/api/api_error';

import {buildPmtilesArchive} from '../../test_support/pmtiles_writer';
import {getPath, TEST_ORIGIN} from '../../test_support/send_request';
import {
  TILE_MAX_AGE_SECONDS,
  TILEJSON_MAX_AGE_SECONDS,
  VERSIONED_TILE_MAX_AGE_SECONDS,
} from './routes';

/** Fake tile bytes that are easy to recognise. */
const WORLD = Uint8Array.from([1, 2, 3]);

/** Stores a small archive and returns bindings that point at it. */
async function withArchive(key: string): Promise<Env> {
  await env.BASEMAP.put(
    key,
    buildPmtilesArchive({
      tiles: [
        {z: 0, x: 0, y: 0, data: WORLD},
        {z: 1, x: 1, y: 0, data: Uint8Array.from([9])},
      ],
      metadata: {vector_layers: [{id: 'earth'}, {id: 'places'}]},
    }),
  );
  return {...env, BASEMAP_ARCHIVE: key} as unknown as Env;
}

/** Bindings pointing at an archive key that was never stored. */
const missingArchive = {
  ...env,
  BASEMAP_ARCHIVE: 'test/missing.pmtiles',
} as unknown as Env;

describe('GET /api/v1/basemap/tiles/:z/:x/:y.mvt', () => {
  it('serves a tile from the archive, cacheable for a day', async () => {
    const bindings = await withArchive('test/hit.pmtiles');

    const response = await getPath(
      '/api/v1/basemap/tiles/0/0/0.mvt',
      {},
      bindings,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/x-protobuf');
    expect(response.headers.get('Cache-Control')).toBe(
      `public, max-age=${String(TILE_MAX_AGE_SECONDS)}`,
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(WORLD);
  });

  it('lets the current archive version be cached for a year', async () => {
    const bindings = await withArchive('test/versioned.pmtiles');

    const response = await getPath(
      '/api/v1/basemap/tiles/0/0/0.mvt?v=test-versioned',
      {},
      bindings,
    );

    expect(response.headers.get('Cache-Control')).toBe(
      `public, max-age=${String(VERSIONED_TILE_MAX_AGE_SECONDS)}, immutable`,
    );
  });

  it('serves the cached copy without reading the archive again', async () => {
    const bindings = await withArchive('test/cached.pmtiles');
    await getPath('/api/v1/basemap/tiles/0/0/0.mvt', {}, bindings);
    await env.BASEMAP.delete('test/cached.pmtiles');

    const response = await getPath(
      '/api/v1/basemap/tiles/0/0/0.mvt',
      {},
      bindings,
    );

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(WORLD);
  });

  it('answers 204 where the archive has no tile', async () => {
    const bindings = await withArchive('test/empty.pmtiles');

    const response = await getPath(
      '/api/v1/basemap/tiles/1/0/0.mvt',
      {},
      bindings,
    );

    expect(response.status).toBe(204);
  });

  it.each([
    ['a zoom level past the grid', '/api/v1/basemap/tiles/23/0/0.mvt'],
    ['an x outside the grid', '/api/v1/basemap/tiles/1/2/0.mvt'],
    ['a y outside the grid', '/api/v1/basemap/tiles/1/0/2.mvt'],
    ['a non-numeric coordinate', '/api/v1/basemap/tiles/one/0/0.mvt'],
    ['another file type', '/api/v1/basemap/tiles/0/0/0.png'],
  ])('answers 400 for %s', async (_label, path) => {
    const bindings = await withArchive('test/bad.pmtiles');

    const response = await getPath(path, {}, bindings);

    expect(response.status).toBe(400);
    expect(ApiErrorResponseSchema.parse(await response.json()).error.code).toBe(
      'INVALID_INPUT',
    );
  });

  it('answers 404 when the configured archive is not in the bucket', async () => {
    const response = await getPath(
      '/api/v1/basemap/tiles/0/0/0.mvt',
      {},
      missingArchive,
    );

    expect(response.status).toBe(404);
    expect(
      ApiErrorResponseSchema.parse(await response.json()).error.message,
    ).toBe("The basemap isn't available yet.");
  });
});

describe('GET /api/v1/basemap/tiles.json', () => {
  it('describes the tiles with a versioned same-origin URL and the credit', async () => {
    const bindings = await withArchive('test/tilejson.pmtiles');

    const response = await getPath('/api/v1/basemap/tiles.json', {}, bindings);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(
      `public, max-age=${String(TILEJSON_MAX_AGE_SECONDS)}`,
    );
    expect(await response.json()).toEqual({
      tilejson: '3.0.0',
      name: 'OrbitalGaze basemap',
      scheme: 'xyz',
      attribution: expect.stringContaining('OpenStreetMap') as unknown,
      tiles: [
        `${TEST_ORIGIN}/api/v1/basemap/tiles/{z}/{x}/{y}.mvt?v=test-tilejson`,
      ],
      minzoom: 0,
      maxzoom: 1,
      bounds: [-180, -85, 180, 85],
      vector_layers: [
        {id: 'earth', fields: {}},
        {id: 'places', fields: {}},
      ],
    });
  });

  it('answers 404 until an archive is stored', async () => {
    const response = await getPath(
      '/api/v1/basemap/tiles.json',
      {},
      missingArchive,
    );

    expect(response.status).toBe(404);
  });

  it('counts basemap requests against their own, larger rate-limit budget', async () => {
    const bindings = await withArchive('test/budget.pmtiles');
    const address = {'CF-Connecting-IP': '203.0.113.77'};

    // More requests than the 30/min search budget, well within 2,400/min.
    const statuses = await Promise.all(
      Array.from({length: 40}, () =>
        getPath('/api/v1/basemap/tiles/0/0/0.mvt', address, bindings).then(
          response => response.status,
        ),
      ),
    );

    expect(statuses.every(status => status === 200)).toBe(true);
  });
});
