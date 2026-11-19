/**
 * @fileoverview HTTP routes for satellite imagery tiles, mounted at `/api/v1/imagery`.
 *
 * Layer: worker routes (server only).
 *
 * The globe's "Satellite" map style shows NASA's Blue Marble mosaic (land
 * with shaded relief, and the ocean floor), from NASA's Global Imagery
 * Browse Services (GIBS). This route fetches each tile from one fixed GIBS
 * URL and keeps it in Cloudflare's cache, so:
 * - visitors' browsers never contact NASA, and the Content Security Policy
 *   stays same-origin;
 * - GIBS sees one request per tile per Cloudflare location per month.
 *
 * Pattern: Proxy (caching). `GET /bluemarble/:z/:x/:y.jpg` validates the
 * coordinates against the tile grid before building the upstream URL from
 * fixed parts; nothing from the request reaches it but three integers.
 *
 * GIBS imagery from NASA missions is public domain (CC0); NASA asks to be
 * credited, which the globe's credit strip does while the style is on.
 * The mosaic stops at zoom 8 (about 600 m per pixel); the client fades
 * back to the vector map beyond it.
 */
import {Hono} from 'hono';
import {z} from 'zod';

import type {AppContext} from '../../app_context';
import {AppError} from '../../lib/errors';
import {fetchBytes, OutboundError} from '../../lib/outbound_fetch';
import {parseInput} from '../../lib/validation';

/** The GIBS host; the only one this route calls. */
const GIBS_HOST = 'gibs.earthdata.nasa.gov';

/** The Blue Marble layer and the deepest zoom GIBS serves it at. */
const BLUE_MARBLE_LAYER = 'BlueMarble_ShadedRelief_Bathymetry';
export const BLUE_MARBLE_MAX_ZOOM = 8;

/**
 * Version of the cached tiles. Blue Marble is a fixed mosaic; change this
 * only to switch layers, so no visitor or cache keeps an old tile.
 */
export const IMAGERY_VERSION = 'bm1';

/** Tiles may be cached for 30 days by browsers and Cloudflare. */
export const IMAGERY_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Largest tile accepted from GIBS (they are about 10–60 kB). */
const MAX_TILE_BYTES = 1024 * 1024;

/** Time allowed per upstream request. */
const TIMEOUT_MS = 10_000;

/** What visitors see when GIBS can't be reached. */
const IMAGERY_UNAVAILABLE_MESSAGE =
  'Satellite imagery is temporarily unavailable.';

/** Path parameters for one tile. `file` is `<y>.jpg`. */
const TileParamsSchema = z
  .object({
    z: z.coerce.number().int().min(0).max(BLUE_MARBLE_MAX_ZOOM),
    x: z.coerce.number().int().min(0),
    file: z.string().regex(/^\d{1,4}\.jpg$/, 'Expected <y>.jpg.'),
  })
  .transform(({z: zoom, x, file}) => ({
    z: zoom,
    x,
    y: Number(file.slice(0, -'.jpg'.length)),
  }))
  .refine(({z: zoom, x, y}) => x < 2 ** zoom && y < 2 ** zoom, {
    message: 'The tile is outside the grid for this zoom level.',
    path: ['x'],
  });

/**
 * The GIBS URL for one tile, from fixed parts and validated numbers.
 *
 * @param tile Validated tile coordinates.
 * @returns The upstream URL (Web Mercator, `GoogleMapsCompatible_Level8`).
 */
export function blueMarbleTileUrl(tile: {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}): URL {
  return new URL(
    `https://${GIBS_HOST}/wmts/epsg3857/best/${BLUE_MARBLE_LAYER}/default/default/GoogleMapsCompatible_Level${String(BLUE_MARBLE_MAX_ZOOM)}/${String(tile.z)}/${String(tile.y)}/${String(tile.x)}.jpg`,
  );
}

/** The key for a tile's copy in Cloudflare's cache (not a real address). */
function cacheKeyFor(tile: {z: number; x: number; y: number}): string {
  return `https://cache.orbitalgaze.internal/api/v1/imagery/${IMAGERY_VERSION}/${String(tile.z)}/${String(tile.x)}/${String(tile.y)}.jpg`;
}

/** Routes for imagery tiles. */
export const imageryRoutes = new Hono<AppContext>().get(
  '/bluemarble/:z/:x/:file',
  async c => {
    // Step 1: accept only real tile coordinates.
    const tile = parseInput(TileParamsSchema, {
      z: c.req.param('z'),
      x: c.req.param('x'),
      file: c.req.param('file'),
    });
    const headers = {
      'Content-Type': 'image/jpeg',
      'Cache-Control': `public, max-age=${String(IMAGERY_MAX_AGE_SECONDS)}`,
    };

    // Step 2: this location's cached copy, if any.
    const cache = caches.default;
    const cacheKey = cacheKeyFor(tile);
    const cached = await cache.match(cacheKey);
    if (cached !== undefined) {
      return c.body(await cached.arrayBuffer(), 200, headers);
    }

    // Step 3: fetch from GIBS. A failure is logged without the URL's
    // details and shown as temporarily unavailable.
    let bytes: Uint8Array;
    try {
      bytes = await fetchBytes(
        blueMarbleTileUrl(tile),
        {
          allowedHosts: [GIBS_HOST],
          timeoutMs: TIMEOUT_MS,
          maxBytes: MAX_TILE_BYTES,
        },
        'image/jpeg',
      );
    } catch (error) {
      c.var.logger.warn('Imagery tile request failed', {
        failure: error instanceof OutboundError ? error.failure : 'unknown',
        status: error instanceof OutboundError ? error.status : null,
      });
      throw new AppError('INTERNAL', IMAGERY_UNAVAILABLE_MESSAGE);
    }
    const body = bytes.slice().buffer;

    // Step 4: keep a copy for the next visitor without delaying this one.
    c.executionCtx.waitUntil(
      cache.put(cacheKey, new Response(body.slice(0), {headers})),
    );
    return c.body(body, 200, headers);
  },
);
