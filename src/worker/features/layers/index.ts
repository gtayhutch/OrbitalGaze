/**
 * @fileoverview Public interface of the snapshot layers feature.
 *
 * Layer: worker feature (server only).
 *
 * A snapshot layer is map data (for example recent earthquakes) that the
 * Worker fetches from a public feed on a schedule, stores in R2 as one
 * file, and serves at `GET /api/v1/layers/:id`. Inside the feature:
 *
 * - `snapshot_source.ts`: the interface each layer's source implements.
 * - `registry.ts`: the layers that are switched on.
 * - `snapshot_service.ts`: schedule checks and refreshes.
 * - `snapshot_repository.ts`: R2 storage.
 * - `routes.ts`: the HTTP route, with edge caching.
 *
 * Other modules import the feature through this file only, never its inner
 * files.
 */
export {createLayerRoutes, layerCacheKey} from './routes';
export {SNAPSHOT_SOURCES} from './registry';
export {
  createSnapshotRepository,
  layerSnapshotKey,
  type SnapshotRepository,
} from './snapshot_repository';
export {
  describeRefreshFailure,
  isDue,
  refreshDueSnapshots,
  refreshSnapshot,
  type RefreshDependencies,
  type RefreshFailure,
  type RefreshOutcome,
  type RefreshResult,
} from './snapshot_service';
export {
  isValidRefreshMinutes,
  REFRESH_STEP_MINUTES,
  type SnapshotFetchContext,
  type SnapshotSource,
} from './snapshot_source';
