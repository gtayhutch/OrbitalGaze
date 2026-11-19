/**
 * @fileoverview Turns the globe's view and active layers into link text, and back.
 *
 * Layer: client feature (browser only). Pure functions; links are untrusted
 * input, so everything read from one is validated with Zod.
 *
 * Formats:
 * - `view`, version 2 (written today):
 *   `2_<lng>_<lat>_<zoom>_<bearing°>_<pitch°>`, for example
 *   `2_139.7454_35.6586_11.00_0.0_0.0`. The leading number is the format
 *   version, so the format can change without breaking old links.
 *   Coordinates keep 4 decimals (about 10 m), which is plenty for a view.
 * - `view`, version 1 (still read): `1_<lng>_<lat>_<height m>_<heading°>_<pitch°>`
 *   from the earlier globe, where pitch −90 looked straight down. Height
 *   becomes an approximate zoom (see {@link zoomForHeight}) and pitch shifts
 *   by 90°, so old links open on about the same place.
 * - `layers`: comma-separated layer IDs, for example `webcams`. An empty
 *   value means "no layers". Unknown IDs (from a newer or older version of
 *   the site) are dropped.
 */
import {z} from 'zod';

import type {CameraView} from '@/client/features/globe';
import {isLayerId, type LayerId} from '@/client/features/layers';

/** Query parameter holding the camera view. */
export const VIEW_URL_PARAM = 'view';

/** Query parameter holding the active layers. */
export const LAYERS_URL_PARAM = 'layers';

/** The `view` format version written today. */
const VIEW_FORMAT_VERSION = '2';

/** The earlier `view` format, still read so old links keep working. */
const LEGACY_VIEW_FORMAT_VERSION = '1';

/**
 * Separator between the fields of a `view` value. URLs never escape `_`, so
 * the address bar stays readable (`~` would show as `%7E`).
 */
const FIELD_SEPARATOR = '_';

/**
 * Deepest zoom a link may ask for. The globe clamps to its own limit; this
 * one only rejects nonsense. (Kept here, not imported from the globe, so this
 * module never pulls the map library into the first bundle.)
 */
const MAX_ZOOM = 24;

/** Largest tilt a link may ask for, in degrees (MapLibre's own maximum). */
const MAX_PITCH = 85;

/** Highest camera height a version 1 link may ask for, in metres. */
const MAX_LEGACY_HEIGHT_METRES = 50_000_000;

/**
 * Converts a camera height to a zoom level: zoom = log2(this / height).
 *
 * It is the height, in metres, from which a typical 800-pixel-tall browser
 * window shows the same ground as zoom 0. That works out to 1.5 × 800 px
 * (MapLibre's camera distance for its 36.87° field of view) times the
 * equator's length over 512 px. For example, 40 km becomes zoom 11.2 and
 * 20,000 km zoom 2.2.
 */
const HEIGHT_AT_ZOOM_ZERO_METRES = 93_925_820;

/** A valid version 2 view, as read from a link. */
const CameraViewSchema = z.object({
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  zoom: z.number().min(0).max(MAX_ZOOM),
  bearing: z.number().min(0).max(360),
  pitch: z.number().min(0).max(MAX_PITCH),
});

/** A valid version 1 view, as read from a link. */
const LegacyCameraViewSchema = z.object({
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  height: z.number().min(1).max(MAX_LEGACY_HEIGHT_METRES),
  heading: z.number().min(0).max(360),
  pitch: z.number().min(-90).max(90),
});

/** Keeps `value` within `min`–`max`. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The zoom level that shows about as much ground as a camera at `height`.
 *
 * @param heightMetres Camera height above the ground, in metres.
 * @returns A zoom level between 0 and 24.
 * @example
 * zoomForHeight(40_000); // ≈ 11.2
 */
export function zoomForHeight(heightMetres: number): number {
  return clamp(
    Math.log2(HEIGHT_AT_ZOOM_ZERO_METRES / heightMetres),
    0,
    MAX_ZOOM,
  );
}

/**
 * Writes a camera view as link text.
 *
 * @param view The view to encode.
 * @returns The `view` parameter value.
 * @example
 * encodeView({lng: 139.7454, lat: 35.6586, zoom: 11, bearing: 0, pitch: 0});
 * // "2_139.7454_35.6586_11.00_0.0_0.0"
 */
export function encodeView(view: CameraView): string {
  // Bearings wrap around (MapLibre reports −180 to 180); keep them in 0–360
  // so the link stays valid.
  const bearing = ((view.bearing % 360) + 360) % 360;
  return [
    VIEW_FORMAT_VERSION,
    view.lng.toFixed(4),
    view.lat.toFixed(4),
    clamp(view.zoom, 0, MAX_ZOOM).toFixed(2),
    bearing.toFixed(1),
    clamp(view.pitch, 0, MAX_PITCH).toFixed(1),
  ].join(FIELD_SEPARATOR);
}

/**
 * Reads a camera view from link text, in the current or the earlier format.
 *
 * @param value The `view` parameter value, or `null` if absent.
 * @returns The view, or `null` when the value is absent, from an unknown
 *     format version, malformed, or out of range.
 * @example
 * decodeView('2_139.7454_35.6586_11.00_0.0_0.0'); // {lng: 139.7454, …, zoom: 11}
 * decodeView('1_139.7454_35.6586_40000_0.0_-90.0'); // {…, zoom: ≈11.2, pitch: 0}
 * decodeView('2_999_0_1_0_0'); // null (longitude out of range)
 */
export function decodeView(value: string | null): CameraView | null {
  if (value === null) {
    return null;
  }
  const [version, ...fields] = value.split(FIELD_SEPARATOR);
  if (fields.length !== 5) {
    return null;
  }
  // `Number('')` is 0, so empty fields are rejected before converting.
  if (fields.some(field => field.trim() === '')) {
    return null;
  }
  const [lng, lat, third, fourth, pitch] = fields.map(Number);

  if (version === VIEW_FORMAT_VERSION) {
    const parsed = CameraViewSchema.safeParse({
      lng,
      lat,
      zoom: third,
      bearing: fourth,
      pitch,
    });
    return parsed.success ? parsed.data : null;
  }
  if (version === LEGACY_VIEW_FORMAT_VERSION) {
    const parsed = LegacyCameraViewSchema.safeParse({
      lng,
      lat,
      height: third,
      heading: fourth,
      pitch,
    });
    if (!parsed.success) {
      return null;
    }
    // The old pitch ran from −90 (straight down) to 0 (the horizon).
    const legacy = parsed.data;
    return {
      lng: legacy.lng,
      lat: legacy.lat,
      zoom: zoomForHeight(legacy.height),
      bearing: legacy.heading,
      pitch: clamp(legacy.pitch + 90, 0, MAX_PITCH),
    };
  }
  return null;
}

/**
 * Writes the active layers as link text.
 *
 * @param layers The active layer IDs.
 * @returns The `layers` parameter value, IDs in the given order.
 * @example
 * encodeLayers(new Set(['webcams'])); // "webcams"
 */
export function encodeLayers(layers: ReadonlySet<LayerId>): string {
  return [...layers].join(',');
}

/**
 * Reads the active layers from link text.
 *
 * @param value The `layers` parameter value, or `null` if absent.
 * @returns The known layer IDs in the value (an empty set means "no
 *     layers"), or `null` when the parameter is absent.
 * @example
 * decodeLayers('webcams,volcanoes'); // Set {'webcams'} (unknown IDs dropped)
 * decodeLayers(null); // null
 */
export function decodeLayers(
  value: string | null,
): ReadonlySet<LayerId> | null {
  if (value === null) {
    return null;
  }
  return new Set(
    value
      .split(',')
      .map(part => part.trim())
      .filter(isLayerId),
  );
}
