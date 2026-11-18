/**
 * @fileoverview HTTP routes for cameras, mounted at `/api/v1/cameras`.
 *
 * Layer: worker routes (server only).
 *
 * - `GET /index`: every online camera's pin data for the globe. It comes
 *   from the index file the import job writes to R2, or from the database
 *   when there is no file yet. The same for every visitor, so it is cached:
 *   browsers and the edge keep it for five minutes, and the Worker also keeps
 *   a copy in Cloudflare's cache, so storage is read at most once per five
 *   minutes per location.
 * - `GET /search?q=`: full-text search, at most 20 results.
 * - `GET /:id`: one camera for the detail panel. Unknown and hidden cameras
 *   both answer 404, so a hidden camera's existence isn't revealed.
 * - `GET /:id/feed`: the camera's current image and player links from its
 *   provider (Windy), checked against the source's allowed hosts. 404 when
 *   there is no feed, for the same reasons as above. Cached for 4 minutes,
 *   because the links expire.
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
import {loadCameraFeed} from './feed_service';
import {CAMERA_INDEX_OBJECT_KEY} from './ingest_service';
import {createCameraRepository} from './repository';
import {createWindyClient} from './sources/windy/client';
import {toFtsQuery} from './search_query';

/** How long, in seconds, browsers and caches may reuse the camera index. */
export const INDEX_MAX_AGE_SECONDS = 300;

/**
 * How long, in seconds, a camera's feed links may be reused. Windy's links
 * last 10 minutes; edge copy plus browser copy stay under 9.
 */
export const FEED_MAX_AGE_SECONDS = 240;

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

    // Step 2: use the prebuilt index file the import job keeps in R2. If
    // it doesn't exist yet (a fresh database, or local synthetic data), build
    // the index from the database instead.
    const prebuilt = await c.env.CAMERA_INDEX.get(CAMERA_INDEX_OBJECT_KEY);
    let body: string;
    if (prebuilt !== null) {
      body = await prebuilt.text();
    } else {
      const cameras = createCameraRepository(c.env.DB);
      const index: CameraIndex = {
        generatedAt: new Date().toISOString(),
        cameras: await cameras.listIndexEntries(),
      };
      body = JSON.stringify({data: index});
    }

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

  .get('/:id/feed', async c => {
    const {id} = parseInput(CameraParamsSchema, {id: c.req.param('id')});
    const cacheControl = `public, max-age=${FEED_MAX_AGE_SECONDS}`;

    // Step 1: serve a recent copy if this location has one. The ID was
    // validated above, so it is safe in the cache key.
    const cache = caches.default;
    const cacheKey = `https://cache.orbitalgaze.internal/api/v1/cameras/${id}/feed?v=1`;
    const cached = await cache.match(cacheKey);
    if (cached !== undefined) {
      return c.body(await cached.text(), 200, {
        'Content-Type': 'application/json; charset=UTF-8',
        'Cache-Control': cacheControl,
      });
    }

    // Step 2: ask the provider for fresh links.
    const config = c.var.config;
    const feed = await loadCameraFeed(
      {
        cameras: createCameraRepository(c.env.DB),
        windy:
          config.windyApiKey === null
            ? null
            : createWindyClient({apiKey: config.windyApiKey}),
        now: new Date(),
        logger: c.var.logger,
      },
      id,
    );
    if (feed === null) {
      throw new AppError(
        'NOT_FOUND',
        'No preview is available for this camera.',
      );
    }
    const body = JSON.stringify({data: feed});

    // Step 3: keep a copy for other visitors, well inside the links' lifetime.
    c.executionCtx.waitUntil(
      cache.put(
        cacheKey,
        new Response(body, {headers: {'Cache-Control': cacheControl}}),
      ),
    );
    return c.body(body, 200, {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': cacheControl,
    });
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
