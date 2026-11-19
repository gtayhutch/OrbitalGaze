/**
 * @fileoverview Draws camera pins on the globe, clusters them, and handles clicks.
 *
 * Layer: client feature (browser only). Created and driven by `globe_view.tsx`.
 *
 * Pins come from two GeoJSON sources:
 * - `cameras`: every visible camera except the selected one. MapLibre
 *   clusters it on the fly: pins closer than {@link CLUSTER_RADIUS_PX}
 *   pixels merge into a numbered teal bubble, and every pin shows on its own
 *   from zoom {@link NO_CLUSTER_FROM_ZOOM} (city scale).
 * - `selected-camera`: the selected camera alone, drawn larger with a white
 *   ring, so it is never hidden inside a cluster.
 *
 * Clicking a pin selects its camera; clicking a cluster zooms in until it
 * splits. Pins use each category's colour from `CATEGORY_STYLES`.
 *
 * The layer can be created before the map's style has loaded: it keeps the
 * latest cameras, filter and selection, and adds its sources and layers as
 * soon as the style is ready.
 */
import type {
  ExpressionSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
} from 'maplibre-gl';

import {CATEGORY_STYLES} from '@/client/features/cameras';
import {prefersReducedMotion} from '@/client/lib/motion';
import {
  CAMERA_CATEGORIES,
  type CameraCategory,
  type CameraIndexEntry,
} from '@/shared/cameras';

import {
  cameraPoints,
  categoryColourPairs,
  emptyCollection,
  type PointCollection,
} from './point_features';

/** Source IDs. */
const CAMERAS_SOURCE = 'cameras';
const SELECTED_SOURCE = 'selected-camera';

/** Layer IDs, bottom to top. */
export const CLUSTER_LAYER = 'camera-clusters';
const CLUSTER_COUNT_LAYER = 'camera-cluster-counts';
export const PIN_LAYER = 'camera-pins';
export const SELECTED_PIN_LAYER = 'camera-selected';

/** Pins closer than this many CSS pixels on screen merge into a cluster. */
const CLUSTER_RADIUS_PX = 48;

/**
 * From this zoom on, every pin shows on its own: at city scale, a cluster
 * would hide cameras the visitor is looking for.
 */
const NO_CLUSTER_FROM_ZOOM = 12;

/** Colour of cluster bubbles (the app's teal accent, dark enough for white digits). */
const CLUSTER_COLOUR = '#0f766e';

/** Ring around cluster bubbles. */
const CLUSTER_RING_COLOUR = '#5eead4';

/** Font for cluster counts; one of the self-hosted basemap fonts. */
const COUNT_FONT = 'Noto Sans Medium';

/** Radius of a single pin, and of the selected pin, in CSS pixels. */
const PIN_RADIUS_PX = 7;
const SELECTED_PIN_RADIUS_PX = 10;

/** Colour for a category the style doesn't know (never expected). */
const FALLBACK_PIN_COLOUR = '#94a3b8';

/** Zoom when flying to a camera: about a city's width in view. */
export const FLY_TO_ZOOM = 11;

/** Duration of a camera flight, in milliseconds (0 with reduced motion). */
const FLY_DURATION_MS = 2_000;

/** What the globe view can do with the camera pins. */
export interface CameraLayer {
  /** Replaces all pins. */
  setCameras(cameras: readonly CameraIndexEntry[]): void;
  /** Shows only pins in these categories. */
  setVisibleCategories(visible: ReadonlySet<CameraCategory>): void;
  /** Highlights one camera's pin and keeps it out of clusters; `null` clears. */
  setSelected(cameraId: string | null): void;
  /** Flies the view to a camera's location. */
  flyTo(location: {readonly lat: number; readonly lng: number}): void;
  /** Removes click handling. Call before `map.remove()`. */
  destroy(): void;
}

/** Each category's pin colour, as a MapLibre expression. */
function pinColour(): ExpressionSpecification {
  // Safe: the pairs alternate category and colour, as `match` expects.
  return [
    'match',
    ['get', 'category'],
    ...categoryColourPairs(category => CATEGORY_STYLES[category].color),
    FALLBACK_PIN_COLOUR,
  ] as unknown as ExpressionSpecification;
}

/** Hands a point collection to a GeoJSON source. */
function setPoints(
  map: MapLibreMap,
  sourceId: string,
  points: PointCollection,
): void {
  // The returned promise only signals when the workers finish; nothing
  // waits for it.
  void map.getSource<GeoJSONSource>(sourceId)?.setData(points);
}

/** Adds the camera sources and layers to a map whose style has loaded. */
function addSourcesAndLayers(map: MapLibreMap): void {
  map.addSource(CAMERAS_SOURCE, {
    type: 'geojson',
    data: emptyCollection(),
    cluster: true,
    clusterRadius: CLUSTER_RADIUS_PX,
    clusterMaxZoom: NO_CLUSTER_FROM_ZOOM - 1,
  });
  map.addSource(SELECTED_SOURCE, {
    type: 'geojson',
    data: emptyCollection(),
  });
  map.addLayer({
    id: CLUSTER_LAYER,
    type: 'circle',
    source: CAMERAS_SOURCE,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': CLUSTER_COLOUR,
      // Bigger bubbles for bigger clusters.
      'circle-radius': ['step', ['get', 'point_count'], 13, 20, 17, 100, 22],
      'circle-stroke-color': CLUSTER_RING_COLOUR,
      'circle-stroke-width': 1.5,
    },
  });
  map.addLayer({
    id: CLUSTER_COUNT_LAYER,
    type: 'symbol',
    source: CAMERAS_SOURCE,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': [COUNT_FONT],
      'text-size': 12,
      'text-allow-overlap': true,
    },
    paint: {'text-color': '#ffffff'},
  });
  map.addLayer({
    id: PIN_LAYER,
    type: 'circle',
    source: CAMERAS_SOURCE,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': pinColour(),
      'circle-radius': PIN_RADIUS_PX,
      'circle-stroke-color': '#020617',
      'circle-stroke-width': 1.5,
    },
  });
  map.addLayer({
    id: SELECTED_PIN_LAYER,
    type: 'circle',
    source: SELECTED_SOURCE,
    paint: {
      'circle-color': pinColour(),
      'circle-radius': SELECTED_PIN_RADIUS_PX,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 3,
    },
  });
}

/**
 * Adds the camera layer to `map`.
 *
 * @param map The globe's map; it must outlive the layer.
 * @param onSelect Called with a camera's ID when its pin is clicked.
 * @returns The layer's controls.
 * @example
 * const layer = createCameraLayer(map, id => setSelectedId(id));
 * layer.setCameras(index.cameras);
 * // later, before map.remove():
 * layer.destroy();
 */
export function createCameraLayer(
  map: MapLibreMap,
  onSelect: (cameraId: string) => void,
): CameraLayer {
  let cameras: readonly CameraIndexEntry[] = [];
  let visibleCategories: ReadonlySet<CameraCategory> = new Set(
    CAMERA_CATEGORIES,
  );
  let selectedId: string | null = null;
  let ready = false;

  // Step 1: push the current state into the sources (once they exist).
  const sync = (): void => {
    if (!ready) {
      return;
    }
    const points = cameraPoints(cameras, visibleCategories, selectedId);
    setPoints(map, CAMERAS_SOURCE, points.clustered);
    setPoints(map, SELECTED_SOURCE, points.selected);
  };

  // Step 2: clicks. A pin selects its camera; a cluster zooms in until it
  // splits apart.
  const onPinClick = (event: MapLayerMouseEvent): void => {
    const id: unknown = event.features?.[0]?.properties['id'];
    if (typeof id === 'string') {
      onSelect(id);
    }
  };
  const onClusterClick = (event: MapLayerMouseEvent): void => {
    const feature = event.features?.[0];
    const clusterId: unknown = feature?.properties['cluster_id'];
    if (feature?.geometry.type !== 'Point' || typeof clusterId !== 'number') {
      return;
    }
    const [lng, lat] = feature.geometry.coordinates;
    void map
      .getSource<GeoJSONSource>(CAMERAS_SOURCE)
      ?.getClusterExpansionZoom(clusterId)
      .then(zoom => {
        map.easeTo({
          center: [lng ?? 0, lat ?? 0],
          zoom,
          duration: prefersReducedMotion() ? 0 : FLY_DURATION_MS / 2,
        });
      });
  };
  // A pointer cursor over anything clickable.
  const showPointer = (): void => {
    map.getCanvas().style.cursor = 'pointer';
  };
  const clearPointer = (): void => {
    map.getCanvas().style.cursor = '';
  };
  const clickableLayers = [CLUSTER_LAYER, PIN_LAYER, SELECTED_PIN_LAYER];

  // Step 3: once the style has loaded, add the sources, layers and click
  // handlers, then draw the state collected so far.
  const setUp = (): void => {
    addSourcesAndLayers(map);
    map.on('click', CLUSTER_LAYER, onClusterClick);
    map.on('click', PIN_LAYER, onPinClick);
    map.on('click', SELECTED_PIN_LAYER, onPinClick);
    for (const layer of clickableLayers) {
      map.on('mouseenter', layer, showPointer);
      map.on('mouseleave', layer, clearPointer);
    }
    ready = true;
    sync();
  };
  if (map.isStyleLoaded() === true) {
    setUp();
  } else {
    map.once('load', setUp);
  }

  return {
    setCameras(next) {
      cameras = next;
      sync();
    },

    setVisibleCategories(visible) {
      visibleCategories = visible;
      sync();
    },

    setSelected(cameraId) {
      if (cameraId === selectedId) {
        return;
      }
      selectedId = cameraId;
      sync();
    },

    flyTo(location) {
      map.flyTo({
        center: [location.lng, location.lat],
        zoom: FLY_TO_ZOOM,
        duration: prefersReducedMotion() ? 0 : FLY_DURATION_MS,
        essential: true,
      });
    },

    destroy() {
      map.off('load', setUp);
      map.off('click', CLUSTER_LAYER, onClusterClick);
      map.off('click', PIN_LAYER, onPinClick);
      map.off('click', SELECTED_PIN_LAYER, onPinClick);
      for (const layer of clickableLayers) {
        map.off('mouseenter', layer, showPointer);
        map.off('mouseleave', layer, clearPointer);
      }
    },
  };
}
