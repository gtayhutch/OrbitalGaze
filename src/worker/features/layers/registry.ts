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
import {CELESTRAK_SATELLITES} from './sources/celestrak_satellites';
import {USGS_EARTHQUAKES} from './sources/usgs_earthquakes';

/**
 * Every snapshot layer, in no particular order. IDs must be unique, and each
 * entry must follow the rules on {@link SnapshotSource} (checked by
 * `registry.test.ts`).
 */
export const SNAPSHOT_SOURCES: readonly SnapshotSource[] = [
  USGS_EARTHQUAKES,
  // CELESTRAK_SATELLITES is paused: CelesTrak refuses requests from
  // Cloudflare's network (HTTP 522, then 403), so registering it would only
  // send failing requests four times a day. Its code and tests stay; add it
  // back once the data path works, together with the client layer.
];

/** Built but not refreshed (see the note in {@link SNAPSHOT_SOURCES}). */
export const PAUSED_SNAPSHOT_SOURCES: readonly SnapshotSource[] = [
  CELESTRAK_SATELLITES,
];
