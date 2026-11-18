/**
 * @fileoverview Hook that keeps one map layer's snapshot up to date.
 *
 * Layer: client library (browser only). Built on `use_polling.ts`; reads
 * `GET /api/v1/layers/:id`, which the Worker serves from the snapshot its
 * refresh job stores (see `src/worker/features/layers/`).
 *
 * Every response is checked against the layer's item schema through the
 * shared `layerSnapshotSchema`, so a layer only ever renders items of the
 * shape it expects. `checkedAt` is passed through so the screen can say how
 * fresh the data is ("Updated 4 min ago").
 */
import {useMemo} from 'react';
import type {z} from 'zod';

import {layerSnapshotSchema, type LayerId} from '@/shared/layers';

import {getJson} from './api_client';
import {usePolling, type PollingState} from './use_polling';

/**
 * Builds the API path of one layer's snapshot.
 *
 * @param layerId The layer.
 * @returns The path relative to the site's origin, for example
 *     `/api/v1/layers/earthquakes`.
 */
export function layerSnapshotPath(layerId: LayerId): string {
  return `/api/v1/layers/${encodeURIComponent(layerId)}`;
}

/**
 * One layer's data as the screen sees it.
 *
 * - `loading`: nothing has loaded yet.
 * - `ready`: the latest snapshot. `refreshFailed` is true when a later
 *   refresh failed and these items are older; `checkedAt` still says when
 *   they were current.
 * - `error`: no snapshot could be loaded (for example the layer isn't
 *   available yet, or the network is down).
 */
export type LayerSnapshotState<Item> =
  | {readonly status: 'loading'}
  | {
      readonly status: 'ready';
      readonly items: readonly Item[];
      /** When the server last fetched the layer's feed (ISO 8601 UTC). */
      readonly checkedAt: string;
      readonly refreshFailed: boolean;
    }
  | {readonly status: 'error'};

/**
 * Maps the polling state onto what layers render.
 *
 * @param state The polling state for the layer's snapshot.
 * @returns The layer's state.
 */
function toLayerSnapshotState<Item>(
  state: PollingState<{readonly items: Item[]; readonly checkedAt: string}>,
): LayerSnapshotState<Item> {
  switch (state.status) {
    case 'loading':
      return {status: 'loading'};
    case 'error':
      return {status: 'error'};
    case 'ready':
      return {
        status: 'ready',
        items: state.data.items,
        checkedAt: state.data.checkedAt,
        refreshFailed: state.lastAttemptFailed,
      };
  }
}

/**
 * Loads a layer's snapshot now and every `intervalMs` while enabled.
 *
 * Polling pauses in hidden tabs, backs off after failures, and never runs
 * two requests at once (see `usePolling`). Failures are logged to the
 * console; the state shows only whether data is available.
 *
 * @param layerId The layer to load, for example `earthquakes`.
 * @param itemSchema The schema each item must match. Define it at module
 *     level so it isn't rebuilt on every render.
 * @param intervalMs Wait between refreshes, in milliseconds. Use the
 *     layer's refresh interval; polling faster only returns cached copies.
 * @param enabled False stops polling (for example while the layer is
 *     switched off). Default true.
 * @returns The layer's state. The object only changes when the state does,
 *     so it is safe in effect dependencies.
 * @example
 * const quakes = useLayerSnapshot('earthquakes', QuakeSchema, 5 * 60_000);
 * if (quakes.status === 'ready') draw(quakes.items);
 */
export function useLayerSnapshot<ItemSchema extends z.ZodType>(
  layerId: LayerId,
  itemSchema: ItemSchema,
  intervalMs: number,
  enabled = true,
): LayerSnapshotState<z.infer<ItemSchema>> {
  const snapshotSchema = useMemo(
    () => layerSnapshotSchema(itemSchema),
    [itemSchema],
  );

  const state = usePolling(
    async signal => {
      try {
        const snapshot = await getJson(
          layerSnapshotPath(layerId),
          snapshotSchema,
          signal,
        );
        // A snapshot for a different layer means something between us and
        // the server is wrong; don't draw it.
        if (snapshot.layerId !== layerId) {
          throw new Error(
            `Expected layer ${layerId}, got ${snapshot.layerId}.`,
          );
        }
        return snapshot;
      } catch (error) {
        if (!signal.aborted) {
          console.error(`Could not load the ${layerId} layer.`, error);
        }
        throw error;
      }
    },
    {key: layerId, intervalMs, enabled},
  );

  // Polling states are stable between renders, so this mapping is too.
  return useMemo(() => toLayerSnapshotState(state), [state]);
}
