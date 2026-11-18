/**
 * @fileoverview Public earthquake snapshot contract shared by the Worker and
 * browser. Locations are epicentres in decimal degrees; depth is in km.
 */
import {z} from 'zod';

/** The layer ID shared by the Worker registry and the browser. */
export const EARTHQUAKE_LAYER_ID = 'earthquakes';

/** How often the Worker fetches a fresh earthquake snapshot. */
export const EARTHQUAKE_REFRESH_MINUTES = 5;

/** Only the fields needed to draw the layer and show its accessible details. */
export const EarthquakeSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9_-]{1,64}$/i),
  place: z.string().trim().min(1).max(240),
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  depthKm: z.number().min(-50).max(1_000),
  magnitude: z.number().min(-10).max(12).nullable(),
  occurredAt: z.iso.datetime(),
});

/** One validated earthquake in a public snapshot. */
export type Earthquake = z.infer<typeof EarthquakeSchema>;
