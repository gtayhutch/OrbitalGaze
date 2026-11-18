/**
 * @fileoverview Storage for layer snapshots in R2.
 *
 * Layer: worker feature repository (server only). Used by
 * `snapshot_service.ts` (writes) and `routes.ts` (reads).
 *
 * Pattern: Repository. Every R2 key and storage option for snapshots lives
 * here, so the service and the route never build keys themselves.
 *
 * Each layer has one object, `layers/<id>/v1.json`, overwritten on every
 * successful refresh. It holds the complete API response body,
 * `{data: {layerId, checkedAt, items}}`, so the route can send the stored
 * text as is without parsing or re-serializing it. The `v1` in the key
 * changes only if the snapshot shape ever changes incompatibly.
 */
import type {LayerId, LayerSnapshot} from '@/shared/layers';

/**
 * Builds the R2 key of a layer's snapshot.
 *
 * @param layerId A validated layer ID (it becomes part of the key).
 * @returns For example `layers/earthquakes/v1.json`.
 */
export function layerSnapshotKey(layerId: LayerId): string {
  return `layers/${layerId}/v1.json`;
}

/** Reads and writes layer snapshots. */
export interface SnapshotRepository {
  /**
   * Returns the stored response body for a layer.
   *
   * @param layerId The layer.
   * @returns The JSON text `{data: …}`, or `null` when the layer has never
   *     been refreshed successfully.
   */
  readSnapshotBody(layerId: LayerId): Promise<string | null>;

  /**
   * Replaces a layer's snapshot with a new one.
   *
   * @param snapshot The validated snapshot to store.
   */
  writeSnapshot(snapshot: LayerSnapshot<unknown>): Promise<void>;
}

/**
 * Creates the snapshot repository over an R2 bucket.
 *
 * @param bucket The `LAYER_SNAPSHOTS` bucket.
 * @returns The repository.
 * @example
 * const snapshots = createSnapshotRepository(env.LAYER_SNAPSHOTS);
 * const body = await snapshots.readSnapshotBody('earthquakes');
 */
export function createSnapshotRepository(bucket: R2Bucket): SnapshotRepository {
  return {
    async readSnapshotBody(layerId) {
      const object = await bucket.get(layerSnapshotKey(layerId));
      if (object === null) {
        return null;
      }
      return object.text();
    },

    async writeSnapshot(snapshot) {
      // Store the full envelope with a JSON content type, so the object is
      // already the API response and reads as JSON in the dashboard too.
      await bucket.put(
        layerSnapshotKey(snapshot.layerId),
        JSON.stringify({data: snapshot}),
        {httpMetadata: {contentType: 'application/json; charset=UTF-8'}},
      );
    },
  };
}
