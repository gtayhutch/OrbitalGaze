/**
 * @fileoverview Public interface of the basemap feature (server side).
 *
 * Layer: worker feature (server only).
 *
 * Serves the globe's vector basemap from our own Protomaps archive in R2:
 * TileJSON plus vector tiles, edge-cached, with no third party involved.
 */
export {
  BasemapUnavailableError,
  createBasemapRepository,
  createR2Source,
  type BasemapInfo,
  type BasemapRepository,
} from './basemap_repository';
export {
  archiveVersion,
  BASEMAP_ATTRIBUTION,
  basemapRoutes,
  basemapTileCacheKey,
  TILE_MAX_AGE_SECONDS,
  TILEJSON_MAX_AGE_SECONDS,
  VERSIONED_TILE_MAX_AGE_SECONDS,
} from './routes';
