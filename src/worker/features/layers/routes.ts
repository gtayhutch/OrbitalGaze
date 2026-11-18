/**
 * @fileoverview HTTP route for snapshot layers, mounted at `/api/v1/layers`.
 *
 * Layer: worker routes (server only).
 *
 * - `GET /:id`: the layer's latest snapshot, `{data: {layerId, checkedAt,
 *   items}}`, exactly as the refresh job stored it in R2. The answer is the
 *   same for every visitor, so it is cached the same way as the camera
 *   index: browsers and the edge may reuse it for the layer's
 *   `maxAgeSeconds`, and the Worker keeps a copy in Cloudflare's cache, so
 *   R2 is read at most once per that period per location.
 *
 * Errors:
 * - 400 for an ID that isn't a well-formed layer ID;
 * - 404 for a well-formed ID that isn't a registered layer;
 * - 404 for a registered layer that has no snapshot yet (its first refresh
 *   hasn't succeeded). Not cached, so the layer appears as soon as it has
 *   data.
 *
 * The router is built from a list of sources so tests can serve fake
 * layers; the app passes `SNAPSHOT_SOURCES`.
 */
import {Hono} from 'hono';
import {z} from 'zod';

import {LayerIdSchema, type LayerId} from '@/shared/layers';

import type {AppContext} from '../../app_context';
import {AppError} from '../../lib/errors';
import {parseInput} from '../../lib/validation';
import {createSnapshotRepository} from './snapshot_repository';
import type {SnapshotSource} from './snapshot_source';

/** Path parameters for one layer. */
const LayerParamsSchema = z.object({id: LayerIdSchema});

/**
 * Builds the key for a layer's copy in Cloudflare's cache. It is not a real
 * address; the cache only needs a stable URL. Bump `v` when the snapshot
 * shape changes so old copies are ignored.
 *
 * @param layerId A validated, registered layer ID.
 * @returns For example
 *     `https://cache.orbitalgaze.internal/api/v1/layers/earthquakes?v=1`.
 */
export function layerCacheKey(layerId: LayerId): string {
  return `https://cache.orbitalgaze.internal/api/v1/layers/${layerId}?v=1`;
}

/**
 * Builds the router for the given snapshot layers.
 *
 * @param sources The layers to serve; only their IDs and `maxAgeSeconds`
 *     are read here.
 * @returns A Hono router to mount at `/v1/layers`.
 * @example
 * app.route('/v1/layers', createLayerRoutes(SNAPSHOT_SOURCES));
 */
export function createLayerRoutes(
  sources: readonly SnapshotSource[],
): Hono<AppContext> {
  const sourcesById = new Map(sources.map(source => [source.id, source]));

  return new Hono<AppContext>().get('/:id', async c => {
    // Step 1: accept only well-formed IDs, then only registered layers. The
    // ID is safe to use in storage and cache keys after both checks.
    const {id} = parseInput(LayerParamsSchema, {id: c.req.param('id')});
    const source = sourcesById.get(id);
    if (source === undefined) {
      throw new AppError('NOT_FOUND', 'There is no layer with this name.');
    }
    const headers = {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': `public, max-age=${source.maxAgeSeconds}`,
    };

    // Step 2: serve the cached copy if this location has one.
    const cache = caches.default;
    const cacheKey = layerCacheKey(id);
    const cached = await cache.match(cacheKey);
    if (cached !== undefined) {
      return c.body(await cached.text(), 200, headers);
    }

    // Step 3: read the stored snapshot. None yet means the layer's first
    // refresh hasn't succeeded.
    const body = await createSnapshotRepository(
      c.env.LAYER_SNAPSHOTS,
    ).readSnapshotBody(id);
    if (body === null) {
      throw new AppError('NOT_FOUND', "This layer isn't available yet.");
    }

    // Step 4: store a copy for the next visitor without delaying this one.
    c.executionCtx.waitUntil(
      cache.put(
        cacheKey,
        new Response(body, {
          headers: {'Cache-Control': headers['Cache-Control']},
        }),
      ),
    );
    return c.body(body, 200, headers);
  });
}
