/**
 * @fileoverview Turns cameras and earthquakes into GeoJSON points for the map.
 *
 * Layer: client feature (browser only). Pure functions, used by
 * `camera_layer.ts` and `earthquake_layer.ts`, and unit tested on their own.
 *
 * MapLibre draws points from GeoJSON sources and styles them from each
 * point's properties, so everything a layer needs to draw a point (its
 * category, size, colour, whether it's selected) is computed here once per
 * update, not on every frame.
 */
import {
  CAMERA_CATEGORIES,
  type CameraCategory,
  type CameraIndexEntry,
} from '@/shared/cameras';
import type {Earthquake} from '@/shared/earthquakes';

/** Property values MapLibre styles can read. */
type PointProperties = Record<string, string | number | boolean>;

/** One GeoJSON point (coordinates are longitude, then latitude). */
export type PointFeature = GeoJSON.Feature<GeoJSON.Point, PointProperties>;

/** A GeoJSON collection of points. */
export type PointCollection = GeoJSON.FeatureCollection<
  GeoJSON.Point,
  PointProperties
>;

/**
 * An empty collection, for sources before their first update.
 *
 * @returns A new, empty collection.
 */
export function emptyCollection(): PointCollection {
  return {type: 'FeatureCollection', features: []};
}

/** Age at which an earthquake marker changes from amber to violet. */
const RECENT_EARTHQUAKE_MS = 60 * 60_000;

/** Recent earthquakes are amber. */
export const RECENT_EARTHQUAKE_COLOUR = '#fbbf24';

/** Older earthquakes in the snapshot are violet. */
export const OLDER_EARTHQUAKE_COLOUR = '#a78bfa';

/** Smallest earthquake marker diameter in CSS pixels. */
const MIN_EARTHQUAKE_DIAMETER = 6;

/** Largest marker diameter in CSS pixels, even for very high magnitudes. */
const MAX_EARTHQUAKE_DIAMETER = 24;

/** Pixels of diameter added per magnitude unit. */
const PIXELS_PER_MAGNITUDE = 2;

/** Builds one point. */
function point(
  lng: number,
  lat: number,
  properties: PointProperties,
): PointFeature {
  return {
    type: 'Feature',
    geometry: {type: 'Point', coordinates: [lng, lat]},
    properties,
  };
}

/** The camera points for the map: the clustered ones and the selected one. */
export interface CameraPoints {
  /** Every visible camera except the selected one; these may cluster. */
  readonly clustered: PointCollection;
  /** The selected camera, if it's visible; never clustered, drawn larger. */
  readonly selected: PointCollection;
}

/**
 * Splits cameras into the points MapLibre draws.
 *
 * @param cameras Every camera in the index.
 * @param visible Categories whose pins are shown.
 * @param selectedId The selected camera, or `null`.
 * @returns The clustered and selected points, each with `id` and
 *     `category` properties.
 * @example
 * const {clustered, selected} = cameraPoints(index.cameras, visible, 'seed-0001');
 */
export function cameraPoints(
  cameras: readonly CameraIndexEntry[],
  visible: ReadonlySet<CameraCategory>,
  selectedId: string | null,
): CameraPoints {
  const clustered: PointFeature[] = [];
  const selected: PointFeature[] = [];
  for (const camera of cameras) {
    if (!visible.has(camera.category)) {
      continue;
    }
    const feature = point(camera.lng, camera.lat, {
      id: camera.id,
      category: camera.category,
    });
    (camera.id === selectedId ? selected : clustered).push(feature);
  }
  return {
    clustered: {type: 'FeatureCollection', features: clustered},
    selected: {type: 'FeatureCollection', features: selected},
  };
}

/**
 * Earthquake epicentres as points, sized by magnitude and coloured by age.
 *
 * @param events The earthquakes in the current snapshot.
 * @param checkedAt When the snapshot was checked (ISO 8601); ages are
 *     measured from it, so colours don't change between refreshes.
 * @param selectedId The earthquake selected in the layer panel, or `null`.
 * @returns Points with `id`, `radius` (CSS pixels), `colour` and
 *     `selected` properties.
 * @example
 * earthquakePoints(snapshot.events, snapshot.checkedAt, null);
 */
export function earthquakePoints(
  events: readonly Earthquake[],
  checkedAt: string | null,
  selectedId: string | null,
): PointCollection {
  const asOf = checkedAt === null ? 0 : Date.parse(checkedAt);
  return {
    type: 'FeatureCollection',
    features: events.map(event => {
      const magnitude = Math.max(0, event.magnitude ?? 0);
      const diameter = Math.min(
        MAX_EARTHQUAKE_DIAMETER,
        MIN_EARTHQUAKE_DIAMETER + PIXELS_PER_MAGNITUDE * magnitude,
      );
      return point(event.lng, event.lat, {
        id: event.id,
        radius: diameter / 2,
        colour:
          asOf - Date.parse(event.occurredAt) < RECENT_EARTHQUAKE_MS
            ? RECENT_EARTHQUAKE_COLOUR
            : OLDER_EARTHQUAKE_COLOUR,
        selected: event.id === selectedId,
      });
    }),
  };
}

/**
 * Every camera category paired with its pin colour, flattened for a
 * MapLibre `match` expression: `[category, colour, category, colour, …]`.
 *
 * @param colourOf The colour for each category.
 * @returns The alternating list.
 */
export function categoryColourPairs(
  colourOf: (category: CameraCategory) => string,
): string[] {
  return CAMERA_CATEGORIES.flatMap(category => [category, colourOf(category)]);
}
