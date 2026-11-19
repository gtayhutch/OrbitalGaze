/**
 * @fileoverview HTTP routes for the basemap, mounted at `/api/v1/basemap`.
 *
 * Layer: worker routes (server only).
 *
 * The globe's map (land, water, roads, borders and place names) is drawn
 * in the browser from vector tiles served here, read from our own
 * Protomaps archive in R2. Visitors' map requests never reach a third
 * party.
 *
 * - `GET /tiles.json`: TileJSON 3.0 describing the tiles (zoom range,
 *   bounds, layer names, credit). The tile URL in it carries the archive
 *   version as `?v=`, so tiles can be cached for a year and a new archive
 *   changes every URL at once.
 * - `GET /tiles/:z/:x/:y.mvt`: one Mapbox vector tile (MVT). 204 when the
 *   archive has no tile there.
 *
 * Both answer in their standard formats, not the API's `{data}` envelope,
 * because MapLibre reads them directly. Both are the same for every visitor
 * and are kept in Cloudflare's cache, so R2 is read at most once per tile
 * per location.
 *
 * Errors: 400 for coordinates that don't exist on the tile grid; 404 when
 * no basemap archive is configured or the configured one isn't in the
 * bucket yet.
 */
import {Hono, type Context} from 'hono';
import {z} from 'zod';

import type {AppContext} from '../../app_context';
import {AppError} from '../../lib/errors';
import {parseInput} from '../../lib/validation';
import {
  BasemapUnavailableError,
  createBasemapRepository,
  type BasemapRepository,
} from './basemap_repository';

/** Deepest zoom level the tile grid accepts (archives stop at 15 today). */
const MAX_TILE_ZOOM = 22;

/** Tiles requested without the current version may be cached for a day. */
export const TILE_MAX_AGE_SECONDS = 86_400;

/** Tiles requested with the current `?v=` may be cached for a year. */
export const VERSIONED_TILE_MAX_AGE_SECONDS = 31_536_000;

/** The TileJSON is small and cheap; browsers recheck it every 5 minutes. */
export const TILEJSON_MAX_AGE_SECONDS = 300;

/** The credit OpenStreetMap's licence and Protomaps ask for. */
export const BASEMAP_ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a> · <a href="https://protomaps.com">Protomaps</a>';

/** Content type for vector tiles; Cloudflare compresses this type. */
const TILE_CONTENT_TYPE = 'application/x-protobuf';

/** Path parameters for one tile. `file` is `<y>.mvt`. */
const TileParamsSchema = z
  .object({
    z: z.coerce.number().int().min(0).max(MAX_TILE_ZOOM),
    x: z.coerce.number().int().min(0),
    file: z.string().regex(/^\d{1,8}\.mvt$/, 'Expected <y>.mvt.'),
  })
  .transform(({z: zoom, x, file}) => ({
    z: zoom,
    x,
    y: Number(file.slice(0, -'.mvt'.length)),
  }))
  .refine(({z: zoom, x, y}) => x < 2 ** zoom && y < 2 ** zoom, {
    message: 'The tile is outside the grid for this zoom level.',
    path: ['x'],
  });

/**
 * A short, URL-safe version string for an archive key, used as `?v=` and in
 * cache keys.
 *
 * @param archiveKey For example `planet/20261118.pmtiles`.
 * @returns For example `planet-20261118`.
 */
export function archiveVersion(archiveKey: string): string {
  return archiveKey.replace(/\.pmtiles$/, '').replaceAll('/', '-');
}

/**
 * The key for a tile's copy in Cloudflare's cache. Not a real address; it
 * includes the archive version, so a new archive never serves old tiles.
 */
export function basemapTileCacheKey(
  archiveKey: string,
  tile: {readonly z: number; readonly x: number; readonly y: number},
): string {
  return `https://cache.orbitalgaze.internal/api/v1/basemap/${archiveVersion(archiveKey)}/${String(tile.z)}/${String(tile.x)}/${String(tile.y)}.mvt`;
}

/** The repository for the configured archive. */
function repositoryFor(c: Context<AppContext>): {
  archiveKey: string;
  basemap: BasemapRepository;
} {
  const archiveKey = c.var.config.basemapArchive;
  if (archiveKey === null) {
    throw new AppError('NOT_FOUND', "The basemap isn't available yet.");
  }
  return {
    archiveKey,
    basemap: createBasemapRepository(c.env.BASEMAP, archiveKey),
  };
}

/** Maps a missing archive to a 404; anything else is a real failure. */
function asNotFound(error: unknown): never {
  if (error instanceof BasemapUnavailableError) {
    throw new AppError('NOT_FOUND', "The basemap isn't available yet.");
  }
  throw error;
}

/** Routes for the basemap. */
export const basemapRoutes = new Hono<AppContext>()
  .get('/tiles.json', async c => {
    const {archiveKey, basemap} = repositoryFor(c);
    const info = await basemap.readInfo().catch(asNotFound);
    const origin = new URL(c.req.url).origin;
    const tileJson = {
      tilejson: '3.0.0',
      name: 'OrbitalGaze basemap',
      scheme: 'xyz',
      attribution: BASEMAP_ATTRIBUTION,
      tiles: [
        `${origin}/api/v1/basemap/tiles/{z}/{x}/{y}.mvt?v=${archiveVersion(archiveKey)}`,
      ],
      minzoom: info.minZoom,
      maxzoom: info.maxZoom,
      bounds: info.bounds,
      vector_layers: info.vectorLayers.map(layer => ({
        id: layer.id,
        fields: {},
      })),
    };
    return c.json(tileJson, 200, {
      'Cache-Control': `public, max-age=${String(TILEJSON_MAX_AGE_SECONDS)}`,
    });
  })
  .get('/tiles/:z/:x/:file', async c => {
    // Step 1: accept only real tile coordinates.
    const tile = parseInput(TileParamsSchema, {
      z: c.req.param('z'),
      x: c.req.param('x'),
      file: c.req.param('file'),
    });
    const {archiveKey, basemap} = repositoryFor(c);
    const versioned = c.req.query('v') === archiveVersion(archiveKey);
    const headers = {
      'Content-Type': TILE_CONTENT_TYPE,
      'Cache-Control': versioned
        ? `public, max-age=${String(VERSIONED_TILE_MAX_AGE_SECONDS)}, immutable`
        : `public, max-age=${String(TILE_MAX_AGE_SECONDS)}`,
    };

    // Step 2: serve this location's cached copy if there is one.
    const cache = caches.default;
    const cacheKey = basemapTileCacheKey(archiveKey, tile);
    const cached = await cache.match(cacheKey);
    if (cached !== undefined) {
      return c.body(await cached.arrayBuffer(), 200, headers);
    }

    // Step 3: read the tile. No tile there (open ocean, or beyond the
    // archive) is a normal, empty answer.
    const bytes = await basemap
      .readTile(tile.z, tile.x, tile.y)
      .catch(asNotFound);
    if (bytes === null) {
      return c.body(null, 204, {'Cache-Control': headers['Cache-Control']});
    }
    // An exact-size copy: the bytes may be a view into a larger buffer.
    const body = bytes.slice().buffer;

    // Step 4: keep a copy for the next visitor without delaying this one.
    c.executionCtx.waitUntil(
      cache.put(
        cacheKey,
        new Response(body.slice(0), {
          headers: {
            'Content-Type': TILE_CONTENT_TYPE,
            'Cache-Control': `public, max-age=${String(VERSIONED_TILE_MAX_AGE_SECONDS)}`,
          },
        }),
      ),
    );
    return c.body(body, 200, headers);
  });
