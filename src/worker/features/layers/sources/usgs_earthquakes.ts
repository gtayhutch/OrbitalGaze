/**
 * @fileoverview USGS past-day earthquake feed for the scheduled snapshot job.
 *
 * Pattern: Strategy. The snapshot service supplies the clock and transport;
 * this module fetches one fixed feed and projects it into our public schema.
 */
import {z} from 'zod';

import {
  EARTHQUAKE_LAYER_ID,
  EARTHQUAKE_REFRESH_MINUTES,
  EarthquakeSchema,
  type Earthquake,
} from '@/shared/earthquakes';

import {fetchJson} from '../../../lib/outbound_fetch';
import type {SnapshotSource} from '../snapshot_source';

/** Keyless USGS feed listing earthquakes recorded in the past day. */
const FEED_URL =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';

/** Documented response is compact; cap unexpected growth at two MiB. */
const MAX_FEED_BYTES = 2 * 1024 * 1024;

/** Upper bound for work performed during one refresh. */
const MAX_FEATURES = 5_000;

/** Reject malformed GeoJSON while leaving room for upstream metadata. */
const FeedSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(z.unknown()).max(MAX_FEATURES),
});

/** The subset of one USGS feature needed for the client projection. */
const FeatureSchema = z.object({
  type: z.literal('Feature'),
  id: z.string(),
  geometry: z.object({
    type: z.literal('Point'),
    coordinates: z.tuple([z.number(), z.number(), z.number()]),
  }),
  properties: z.object({
    place: z.string().nullable(),
    mag: z.number().nullable(),
    // Bounds prevent invalid Date values from reaching toISOString().
    time: z.number().int().min(0).max(253_402_300_799_999),
  }),
});

/**
 * Projects one validated feed into unique events sorted newest first.
 * A broken item is skipped. An entirely invalid, nonempty feed fails refresh
 * so the service retains the previous good snapshot.
 *
 * @example
 * const events = normalizeEarthquakeFeed({type: 'FeatureCollection', features: []});
 */
export function normalizeEarthquakeFeed(input: unknown): Earthquake[] {
  const {features} = FeedSchema.parse(input);
  const events = new Map<string, Earthquake>();
  for (const feature of features) {
    const parsed = FeatureSchema.safeParse(feature);
    if (!parsed.success) {
      continue;
    }

    const {id, geometry, properties} = parsed.data;
    const [lng, lat, depthKm] = geometry.coordinates;
    const quake = EarthquakeSchema.safeParse({
      id,
      place: properties.place?.trim() || 'Location unavailable',
      lng,
      lat,
      depthKm,
      magnitude: properties.mag,
      occurredAt: new Date(properties.time).toISOString(),
    });
    if (quake.success && !events.has(id)) {
      events.set(id, quake.data);
    }
  }
  if (features.length > 0 && events.size === 0) {
    throw new Error('The earthquake feed contained no valid events.');
  }
  return [...events.values()].sort((a, b) =>
    b.occurredAt.localeCompare(a.occurredAt),
  );
}

/** Refreshes recent USGS earthquake data through the allowlisted transport. */
export const USGS_EARTHQUAKES: SnapshotSource<Earthquake> = {
  id: EARTHQUAKE_LAYER_ID,
  refreshMinutes: EARTHQUAKE_REFRESH_MINUTES,
  maxAgeSeconds: 60,
  async fetchItems({fetch}) {
    const raw = await fetchJson(new URL(FEED_URL), {
      allowedHosts: ['earthquake.usgs.gov'],
      timeoutMs: 10_000,
      maxBytes: MAX_FEED_BYTES,
      fetch,
    });
    return normalizeEarthquakeFeed(raw);
  },
};
