/**
 * @fileoverview The list of snapshot layers the Worker refreshes and serves.
 *
 * Layer: worker feature (server only). Read by `app.ts` (to mount the layer
 * route) and `jobs/scheduled.ts` (to run the refresh cron).
 *
 * This is the one place a snapshot layer is switched on. It is empty until
 * the first layer (earthquakes) arrives; tests pass their own fake sources
 * instead of relying on this list.
 */
import type {SnapshotSource} from './snapshot_source';

/**
 * Every snapshot layer, in no particular order. IDs must be unique, and each
 * entry must follow the rules on {@link SnapshotSource} (checked by
 * `registry.test.ts`).
 */
export const SNAPSHOT_SOURCES: readonly SnapshotSource[] = [];
