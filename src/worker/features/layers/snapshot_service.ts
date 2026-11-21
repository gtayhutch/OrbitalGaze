/**
 * @fileoverview Refreshes layer snapshots: decides which layers are due,
 * fetches their items, and stores the result.
 *
 * Layer: worker feature service (server only). Called by the refresh cron in
 * `src/worker/jobs/scheduled.ts`, which passes in the bucket, the scheduled
 * time, and `fetch`. Works with `snapshot_source.ts` (the strategy each
 * layer implements) and `snapshot_repository.ts` (R2 storage).
 *
 * How a refresh behaves:
 * - The cron fires every five minutes; {@link isDue} picks the layers whose
 *   interval lines up with that minute of the UTC day.
 * - {@link refreshSnapshot} overwrites a layer's snapshot only after its
 *   items were fetched and validated. Any failure throws before the write,
 *   so visitors keep getting the previous snapshot (with its older
 *   `checkedAt`) instead of an empty or broken layer.
 * - {@link refreshDueSnapshots} runs the due layers in parallel and reports
 *   one outcome per layer; one layer failing never stops the others.
 */
import {z} from 'zod';

import {layerSnapshotSchema, type LayerId} from '@/shared/layers';

import {
  OutboundError,
  type FetchFunction,
  type OutboundFailure,
} from '../../lib/outbound_fetch';
import {createSnapshotRepository} from './snapshot_repository';
import type {WorkerConfig} from '../../lib/config';
import {SourceNotConfiguredError, type SnapshotSource} from './snapshot_source';

/**
 * Checks a snapshot's outer shape (ID format, timestamp, item cap) before it
 * is stored. The items themselves were validated by the source.
 */
const StoredSnapshotSchema = layerSnapshotSchema(z.unknown());

/** What a refresh needs from the outside world. */
export interface RefreshDependencies {
  /** The `LAYER_SNAPSHOTS` bucket. */
  readonly bucket: R2Bucket;
  /** The cron's scheduled time; becomes the snapshot's `checkedAt`. */
  readonly now: Date;
  /** Passed to the source for its outbound requests. */
  readonly fetch: FetchFunction;
  /** The Worker's settings (credentials, per-environment offsets). */
  readonly config: WorkerConfig;
}

/** What one successful refresh stored. */
export interface RefreshResult {
  /** The layer that was refreshed. */
  readonly layerId: LayerId;
  /** How many items the new snapshot holds. */
  readonly items: number;
  /** The new snapshot's `checkedAt` (ISO 8601 UTC). */
  readonly checkedAt: string;
}

/**
 * Why a refresh failed, safe to log. Outbound failures keep their kind
 * (`timeout`, `http-status`, …); `invalid-data` means the feed answered but
 * its data didn't pass validation; `unexpected` is anything else, such as a
 * storage error. Never contains anything the feed sent.
 */
export type RefreshFailure =
  OutboundFailure | 'invalid-data' | 'not-configured' | 'unexpected';

/** The result of one layer's refresh attempt, for the job's log. */
export interface RefreshOutcome {
  /** The layer. */
  readonly layerId: LayerId;
  /** Items stored, or `null` when the refresh failed. */
  readonly items: number | null;
  /** How long the attempt took, in milliseconds. */
  readonly durationMs: number;
  /** Why it failed, or `null` on success. */
  readonly failure: RefreshFailure | null;
  /** The feed's HTTP status when it answered with an error, else `null`. */
  readonly httpStatus: number | null;
  /** The error's class name for `unexpected` failures, else `null`. */
  readonly errorName: string | null;
}

/**
 * Tells whether a layer should refresh at this cron run.
 *
 * Intervals are counted from midnight UTC plus the source's offset, so a
 * 15-minute layer refreshes at :00, :15, :30 and :45 every hour, and a
 * 6-hour layer with a 25-minute offset at 00:25, 06:25, 12:25 and 18:25,
 * whatever time the Worker was deployed. The cron's scheduled time always
 * falls on a whole minute, so seconds are ignored.
 *
 * @param source The layer's source (only its interval is read).
 * @param now The cron's scheduled time.
 * @param offsetMinutes The source's offset for this environment (default 0).
 * @returns True when the minute of the UTC day, less the offset, is a
 *     multiple of the layer's `refreshMinutes`.
 * @example
 * isDue({refreshMinutes: 15}, new Date('2026-11-18T10:45:00Z')); // true
 * isDue({refreshMinutes: 15}, new Date('2026-11-18T10:50:00Z')); // false
 * isDue({refreshMinutes: 360}, new Date('2026-11-18T06:25:00Z'), 25); // true
 */
export function isDue(
  source: Pick<SnapshotSource, 'refreshMinutes'>,
  now: Date,
  offsetMinutes = 0,
): boolean {
  const minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
  const sinceOffset =
    (minuteOfDay - offsetMinutes + 24 * 60) % source.refreshMinutes;
  return sinceOffset === 0;
}

/**
 * Fetches a layer's items and replaces its stored snapshot.
 *
 * @param source The layer's source.
 * @param deps The bucket, the scheduled time, and `fetch`.
 * @returns What was stored.
 * @throws {OutboundError} When the feed can't be read.
 * @throws {z.ZodError} When the feed's data, or the snapshot's outer shape,
 *     is invalid (for example more items than the cap).
 * @throws {Error} When R2 refuses the write.
 *     In every case the previous snapshot is left unchanged.
 * @example
 * const result = await refreshSnapshot(source, {
 *   bucket: env.LAYER_SNAPSHOTS,
 *   now: new Date(controller.scheduledTime),
 *   fetch,
 * });
 */
export async function refreshSnapshot(
  source: SnapshotSource,
  deps: RefreshDependencies,
): Promise<RefreshResult> {
  // Step 1: ask the source for fresh, validated items. If this throws,
  // nothing below runs, so the previous snapshot stays in place.
  const items = await source.fetchItems({
    fetch: deps.fetch,
    now: deps.now,
    config: deps.config,
  });

  // Step 2: build the snapshot and check its outer shape, so a source can't
  // store an oversized list or a malformed ID.
  const snapshot = StoredSnapshotSchema.parse({
    layerId: source.id,
    checkedAt: deps.now.toISOString(),
    items,
  });

  // Step 3: overwrite the stored snapshot in one write.
  await createSnapshotRepository(deps.bucket).writeSnapshot(snapshot);
  return {
    layerId: snapshot.layerId,
    items: snapshot.items.length,
    checkedAt: snapshot.checkedAt,
  };
}

/**
 * Turns a refresh error into fields that are safe to log.
 *
 * Error messages are deliberately dropped: a parse error's message can quote
 * the feed's body, and nothing a feed sends is ever written to our logs.
 *
 * @param error What the refresh threw.
 * @returns The failure kind, the feed's HTTP status if any, and the error's
 *     class name for unexpected errors.
 */
export function describeRefreshFailure(
  error: unknown,
): Pick<RefreshOutcome, 'failure' | 'httpStatus' | 'errorName'> {
  if (error instanceof OutboundError) {
    return {failure: error.failure, httpStatus: error.status, errorName: null};
  }
  if (error instanceof z.ZodError) {
    return {failure: 'invalid-data', httpStatus: null, errorName: null};
  }
  if (error instanceof SourceNotConfiguredError) {
    return {failure: 'not-configured', httpStatus: null, errorName: null};
  }
  const errorName = error instanceof Error ? error.name : typeof error;
  return {failure: 'unexpected', httpStatus: null, errorName};
}

/**
 * Refreshes one layer and records how long it took, whether or not it
 * succeeded.
 *
 * @param source The layer's source.
 * @param deps See {@link refreshSnapshot}.
 * @param durations Where the duration is recorded, keyed by layer ID.
 * @returns What was stored.
 * @throws {Error} Whatever {@link refreshSnapshot} throws.
 */
async function timedRefresh(
  source: SnapshotSource,
  deps: RefreshDependencies,
  durations: Map<LayerId, number>,
): Promise<RefreshResult> {
  const startedAt = Date.now();
  try {
    return await refreshSnapshot(source, deps);
  } finally {
    durations.set(source.id, Date.now() - startedAt);
  }
}

/**
 * Refreshes every layer that is due at `deps.now`, in parallel.
 *
 * @param sources All snapshot sources (normally `SNAPSHOT_SOURCES`).
 * @param deps See {@link refreshSnapshot}.
 * @returns One outcome per due layer, in the order of `sources`; an empty
 *     list when nothing is due. Never throws for a layer's failure.
 * @example
 * const outcomes = await refreshDueSnapshots(SNAPSHOT_SOURCES, deps);
 * for (const outcome of outcomes) logger.info('layer refresh', {...outcome});
 */
export async function refreshDueSnapshots(
  sources: readonly SnapshotSource[],
  deps: RefreshDependencies,
): Promise<RefreshOutcome[]> {
  const due = sources.filter(source =>
    isDue(source, deps.now, source.refreshOffsetMinutes?.(deps.config) ?? 0),
  );

  // Promise.allSettled rather than Promise.all: every due layer runs to the
  // end and reports, even when another layer's feed is down.
  const durations = new Map<LayerId, number>();
  const settled = await Promise.allSettled(
    due.map(source => timedRefresh(source, deps, durations)),
  );

  // allSettled keeps the input order, so result i belongs to due layer i.
  return due.map((source, index) => {
    const result = settled[index];
    const durationMs = durations.get(source.id) ?? 0;
    if (result?.status === 'fulfilled') {
      return {
        layerId: source.id,
        items: result.value.items,
        durationMs,
        failure: null,
        httpStatus: null,
        errorName: null,
      };
    }
    return {
      layerId: source.id,
      items: null,
      durationMs,
      ...describeRefreshFailure(result?.reason),
    };
  });
}
