/**
 * @fileoverview The contract every snapshot layer's data source fulfils.
 *
 * Layer: worker feature (server only). Implemented once per layer (for
 * example a future earthquakes source) and listed in `registry.ts`. The
 * refresh job and the layer route only ever talk to this interface.
 *
 * Pattern: Strategy. The snapshot pipeline (schedule, fetch, store, serve)
 * is the same for every layer; only "how to fetch and validate this layer's
 * items" differs. Each source is one interchangeable strategy:
 *
 * - {@link SnapshotSource}: the strategy interface.
 * - A concrete source: one object per layer, holding its schedule, cache
 *   lifetime, and `fetchItems`.
 * - `snapshot_service.ts`: the context that runs whichever sources are due.
 *
 * Adding a layer means writing one source and adding it to the registry;
 * the job, storage, route, and caching need no change.
 */
import type {LayerId} from '@/shared/layers';

import type {FetchFunction} from '../../lib/outbound_fetch';

/**
 * How often the refresh cron fires, in minutes (`LAYER_REFRESH_CRON` in
 * `jobs/scheduled.ts`, every five minutes). A source's refresh interval must
 * be a multiple of it.
 */
export const REFRESH_STEP_MINUTES = 5;

/** Minutes in a UTC day; refresh intervals must divide it evenly. */
const MINUTES_PER_DAY = 24 * 60;

/** What a source receives when it is asked for fresh items. */
export interface SnapshotFetchContext {
  /**
   * The `fetch` to pass to `fetchJson`. It is the runtime's in production;
   * tests inject a fake so no test reaches the internet.
   */
  readonly fetch: FetchFunction;
  /** When the refresh was scheduled; use it instead of reading the clock. */
  readonly now: Date;
}

/**
 * One layer's data source: its schedule, its cache lifetime, and how to get
 * its items.
 *
 * @typeParam Item The validated shape of one item (for example one quake).
 */
export interface SnapshotSource<Item = unknown> {
  /** The layer's ID; also its URL segment and storage folder. */
  readonly id: LayerId;
  /**
   * Minutes between refreshes, counted from midnight UTC. Must be a positive
   * multiple of {@link REFRESH_STEP_MINUTES} that divides a day evenly (for
   * example 5, 15, 60, or 240), so the schedule has no uneven gap at
   * midnight. Checked by {@link isValidRefreshMinutes} in the registry test.
   */
  readonly refreshMinutes: number;
  /**
   * How long, in seconds, browsers and Cloudflare's cache may reuse the
   * served snapshot. Usually at most the refresh interval, so visitors never
   * see data more than one refresh old.
   */
  readonly maxAgeSeconds: number;
  /**
   * Fetches the layer's current items from its public feed.
   *
   * Implementations must:
   * - call only fixed `https` URLs on their own hosts, through `fetchJson`
   *   with an allowlist, a timeout, and a size cap;
   * - validate the response with a Zod schema and return only items that
   *   passed;
   * - throw (for example `OutboundError` or a Zod error) when the feed can't
   *   be read, so the previous snapshot stays in place.
   *
   * @param context The `fetch` to use and the scheduled time.
   * @returns The validated items.
   * @throws {Error} When the feed is unreachable or its data is invalid.
   */
  fetchItems(context: SnapshotFetchContext): Promise<readonly Item[]>;
}

/**
 * Checks that a refresh interval fits the 5-minute cron and the UTC day.
 *
 * @param minutes The proposed interval.
 * @returns True for a positive whole multiple of {@link REFRESH_STEP_MINUTES}
 *     that divides 1,440 (the minutes in a day).
 * @example
 * isValidRefreshMinutes(15); // true
 * isValidRefreshMinutes(35); // false: 1,440 isn't a multiple of 35
 */
export function isValidRefreshMinutes(minutes: number): boolean {
  return (
    Number.isInteger(minutes) &&
    minutes > 0 &&
    minutes % REFRESH_STEP_MINUTES === 0 &&
    MINUTES_PER_DAY % minutes === 0
  );
}
