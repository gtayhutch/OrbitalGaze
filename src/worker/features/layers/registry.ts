/**
 * @fileoverview The list of snapshot layers the Worker refreshes and serves.
 *
 * Layer: worker feature (server only). Read by `app.ts` (to mount the layer
 * route) and `jobs/scheduled.ts` (to run the refresh cron).
 *
 * This is the one place a snapshot layer is switched on. Tests can pass
 * fake sources without reaching the real network.
 */
import type {SnapshotSource} from './snapshot_source';
import {USGS_EARTHQUAKES} from './sources/usgs_earthquakes';

/**
 * Every snapshot layer, in no particular order. IDs must be unique, and each
 * entry must follow the rules on {@link SnapshotSource} (checked by
 * `registry.test.ts`).
 */
export const SNAPSHOT_SOURCES: readonly SnapshotSource[] = [USGS_EARTHQUAKES];
