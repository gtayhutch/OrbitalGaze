/**
 * @fileoverview HTTP routes for cameras, mounted at `/api/v1/cameras`.
 *
 * Layer: worker routes (server only).
 *
 * - `GET /index`: every online camera's pin data for the globe. The same
 *   for every visitor, so it is cached: browsers and the edge keep it for
 *   five minutes, and the Worker also keeps a copy in Cloudflare's cache, so
 *   the database is read at most once per five minutes per location.
 * - `GET /search?q=`: full-text search, at most 20 results.
 * - `GET /:id`: one camera for the detail panel. Unknown and hidden cameras
 *   both answer 404, so a hidden camera's existence isn't revealed.
 *
 * Handlers stay thin: validate input, call the repository, shape the reply.
 * The camera's feed location never appears in any response.
 */
import {Hono} from 'hono';
import {z} from 'zod';

import type {CameraIndex, CameraSearchResponse} from '@/shared/cameras';
import {
  CameraIdSchema,
  MAX_SEARCH_QUERY_LENGTH,
  MAX_SEARCH_RESULTS,
} from '@/shared/cameras';

import type {AppContext} from '../../app_context';
import {AppError} from '../../lib/errors';
import {parseInput} from '../../lib/validation';
import {createCameraRepository} from './repository';
import {toFtsQuery} from './search_query';

/** How long, in seconds, browsers and caches may reuse the camera index. */
export const INDEX_MAX_AGE_SECONDS = 300;

/**
 * Key for the index in Cloudflare's cache. It is not a real address; the
 * cache only needs a stable URL. Bump `v` when the index shape changes so old
 * copies are ignored.
 */
const INDEX_CACHE_KEY =
  'https://cache.orbitalgaze.internal/api/v1/cameras/index?v=1';

/** Query parameters for search. */
const SearchParamsSchema = z.object({
  q: z
    .string({error: 'Enter something to search for.'})
    .trim()
    .min(1, 'Enter something to search for.')
    .max(
      MAX_SEARCH_QUERY_LENGTH,
      `Search text can be at most ${MAX_SEARCH_QUERY_LENGTH} characters.`,
    ),
});

/** Path parameters for one camera. */
const CameraParamsSchema = z.object({id: CameraIdSchema});

/** Router for the cameras feature. */
export const cameraRoutes = new Hono<AppContext>()
  .get('/index', async c => {
    const cacheControl = `public, max-age=${INDEX_MAX_AGE_SECONDS}`;

    // Step 1: serve the cached copy if this location has one.
    const cache = caches.default;
    const cached = await cache.match(INDEX_CACHE_KEY);
    if (cached !== undefined) {
      return c.body(await cached.text(), 200, {
        'Content-Type': 'application/json; charset=UTF-8',
        'Cache-Control': cacheControl,
      });
    }

    // Step 2: build the index from the database.
    const cameras = createCameraRepository(c.env.DB);
    const index: CameraIndex = {
      generatedAt: new Date().toISOString(),
      cameras: await cameras.listIndexEntries(),
    };
    const body = JSON.stringify({data: index});

    // Step 3: store a copy for the next visitor without delaying this one.
    c.executionCtx.waitUntil(
      cache.put(
        INDEX_CACHE_KEY,
        new Response(body, {headers: {'Cache-Control': cacheControl}}),
      ),
    );
    return c.body(body, 200, {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': cacheControl,
    });
  })

  .get('/search', async c => {
    const {q} = parseInput(SearchParamsSchema, {q: c.req.query('q')});
    const ftsQuery = toFtsQuery(q);
    if (ftsQuery === null) {
      throw new AppError('INVALID_INPUT', 'Some of the request is invalid.', {
        q: ['Search with letters or numbers.'],
      });
    }
    const cameras = createCameraRepository(c.env.DB);
    const body: CameraSearchResponse = {
      results: await cameras.searchByText(ftsQuery, MAX_SEARCH_RESULTS),
    };
    return c.json({data: body});
  })

  .get('/:id', async c => {
    const {id} = parseInput(CameraParamsSchema, {id: c.req.param('id')});
    const cameras = createCameraRepository(c.env.DB);
    const camera = await cameras.findPublicById(id);
    if (camera === null) {
      throw new AppError('NOT_FOUND', "This camera isn't available.");
    }
    return c.json({data: camera});
  });
