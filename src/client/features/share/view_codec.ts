/**
 * @fileoverview Turns the globe's view and active layers into link text, and back.
 *
 * Layer: client feature (browser only). Pure functions; links are untrusted
 * input, so everything read from one is validated with Zod.
 *
 * Formats:
 * - `view`: `1_<lng>_<lat>_<height m>_<heading°>_<pitch°>`, for example
 *   `1_139.7454_35.6586_40000_0.0_-90.0`. The leading `1` is the format
 *   version, so the format can change later without breaking old links.
 *   Coordinates keep 4 decimals (about 10 m), which is plenty for a view.
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

/** The current `view` format version. */
const VIEW_FORMAT_VERSION = '1';

/**
 * Separator between the fields of a `view` value. URLs never escape `_`, so
 * the address bar stays readable (`~` would show as `%7E`).
 */
const FIELD_SEPARATOR = '_';

/** Highest camera height a link may ask for, in metres (well past the Moon is silly). */
const MAX_HEIGHT_METRES = 50_000_000;

/** A valid camera view, as read from a link. */
const CameraViewSchema = z.object({
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  height: z.number().min(1).max(MAX_HEIGHT_METRES),
  heading: z.number().min(0).max(360),
  pitch: z.number().min(-90).max(90),
});

/**
 * Writes a camera view as link text.
 *
 * @param view The view to encode.
 * @returns The `view` parameter value.
 * @example
 * encodeView({lng: 139.7454, lat: 35.6586, height: 40_000, heading: 0, pitch: -90});
 * // "1_139.7454_35.6586_40000_0.0_-90.0"
 */
export function encodeView(view: CameraView): string {
  // Headings wrap around; keep them in 0–360 so the link stays valid.
  const heading = ((view.heading % 360) + 360) % 360;
  return [
    VIEW_FORMAT_VERSION,
    view.lng.toFixed(4),
    view.lat.toFixed(4),
    String(Math.round(view.height)),
    heading.toFixed(1),
    view.pitch.toFixed(1),
  ].join(FIELD_SEPARATOR);
}

/**
 * Reads a camera view from link text.
 *
 * @param value The `view` parameter value, or `null` if absent.
 * @returns The view, or `null` when the value is absent, from an unknown
 *     format version, malformed, or out of range.
 * @example
 * decodeView('1_139.7454_35.6586_40000_0.0_-90.0'); // {lng: 139.7454, …}
 * decodeView('1_999_0_1_0_0'); // null (longitude out of range)
 */
export function decodeView(value: string | null): CameraView | null {
  if (value === null) {
    return null;
  }
  const [version, ...fields] = value.split(FIELD_SEPARATOR);
  if (version !== VIEW_FORMAT_VERSION || fields.length !== 5) {
    return null;
  }
  // `Number('')` is 0, so empty fields are rejected before converting.
  if (fields.some(field => field.trim() === '')) {
    return null;
  }
  const [lng, lat, height, heading, pitch] = fields.map(Number);
  const parsed = CameraViewSchema.safeParse({lng, lat, height, heading, pitch});
  return parsed.success ? parsed.data : null;
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
