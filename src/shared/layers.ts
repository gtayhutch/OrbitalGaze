/**
 * @fileoverview Map layer shapes shared by the API and the browser app.
 *
 * Layer: shared (no I/O).
 *
 * A "snapshot layer" is data the Worker fetches from a public feed on a
 * schedule (for example recent earthquakes) and stores as one file. Every
 * snapshot has the same outer shape, `{layerId, checkedAt, items}`; only the
 * items differ per layer. {@link layerSnapshotSchema} builds the schema for
 * one layer from its item schema, so the Worker (before storing) and the
 * browser (after fetching) check the same contract.
 *
 * Works with `src/worker/features/layers/` (which writes and serves
 * snapshots) and `src/client/lib/use_layer_snapshot.ts` (which polls them).
 */
import {z} from 'zod';

/**
 * Layer IDs: lowercase letters, digits, and hyphens, starting with a letter,
 * at most 40 characters (for example `earthquakes`). They appear in URLs and
 * storage keys, so anything else is rejected before it is used.
 */
export const LayerIdSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]{0,39}$/,
    'Layer IDs contain only lowercase letters, digits, and hyphens.',
  );

/** A validated layer ID, such as `earthquakes`. */
export type LayerId = z.infer<typeof LayerIdSchema>;

/**
 * Most items one snapshot may hold. Matches the camera index's ceiling: the
 * globe stays responsive at this many points, and a feed that suddenly sends
 * more is treated as broken rather than stored.
 */
export const MAX_LAYER_SNAPSHOT_ITEMS = 50_000;

/**
 * Builds the schema for one layer's snapshot (the payload inside the API's
 * `data` envelope).
 *
 * @param itemSchema The schema each item must match.
 * @returns A schema for `{layerId, checkedAt, items}`, where `checkedAt` is
 *     when the Worker last fetched the feed successfully (ISO 8601 UTC) and
 *     `items` holds at most {@link MAX_LAYER_SNAPSHOT_ITEMS} entries.
 * @example
 * const QuakeSnapshotSchema = layerSnapshotSchema(QuakeSchema);
 * const snapshot = QuakeSnapshotSchema.parse(data);
 */
export function layerSnapshotSchema<Item extends z.ZodType>(
  itemSchema: Item,
): z.ZodObject<{
  layerId: typeof LayerIdSchema;
  checkedAt: z.ZodISODateTime;
  items: z.ZodArray<Item>;
}> {
  return z.object({
    layerId: LayerIdSchema,
    checkedAt: z.iso.datetime(),
    items: z.array(itemSchema).max(MAX_LAYER_SNAPSHOT_ITEMS),
  });
}

/** One layer's stored data: which layer, when it was checked, and its items. */
export interface LayerSnapshot<Item> {
  /** The layer this snapshot belongs to. */
  readonly layerId: LayerId;
  /** When the feed was last fetched successfully, as ISO 8601 UTC. */
  readonly checkedAt: string;
  /** The layer's items, already validated. */
  readonly items: readonly Item[];
}
