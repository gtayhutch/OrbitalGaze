/**
 * @fileoverview Draws earthquake epicentres on the globe.
 *
 * Layer: client feature (browser only). Created and driven by `globe_view.tsx`.
 *
 * One circle per earthquake, from a GeoJSON source: sized by magnitude,
 * amber within the last hour and violet before that, with a white ring on
 * the one selected in the layer panel (`point_features.ts` computes all
 * three). The circles sit below the camera pins. The app's earthquake list
 * offers keyboard access to the same events and details.
 *
 * Like the camera layer, it can be created before the map's style has
 * loaded; it draws the latest update once the style is ready.
 */
import type {GeoJSONSource, Map as MapLibreMap} from 'maplibre-gl';

import type {Earthquake} from '@/shared/earthquakes';

import {CLUSTER_LAYER} from './camera_layer';
import {earthquakePoints, emptyCollection} from './point_features';

/** Source and layer ID. */
const EARTHQUAKES_ID = 'earthquakes';

/** The globe's handle to the earthquake markers. */
export interface EarthquakeLayer {
  /** Redraws every marker after a refresh or a selection change. */
  update(
    events: readonly Earthquake[],
    checkedAt: string | null,
    selected: string | null,
  ): void;
  /** Stops waiting for the style. Call before `map.remove()`. */
  destroy(): void;
}

/**
 * Adds the earthquake layer to `map`, below the camera pins.
 *
 * @param map The globe's map; it must outlive the layer.
 * @returns The layer's controls.
 * @example
 * const layer = createEarthquakeLayer(map);
 * layer.update(snapshot.events, snapshot.checkedAt, null);
 */
export function createEarthquakeLayer(map: MapLibreMap): EarthquakeLayer {
  let latest = emptyCollection();
  let ready = false;

  const draw = (): void => {
    if (ready) {
      // Nothing waits for the workers to finish.
      void map.getSource<GeoJSONSource>(EARTHQUAKES_ID)?.setData(latest);
    }
  };

  const setUp = (): void => {
    map.addSource(EARTHQUAKES_ID, {
      type: 'geojson',
      data: emptyCollection(),
    });
    map.addLayer(
      {
        id: EARTHQUAKES_ID,
        type: 'circle',
        source: EARTHQUAKES_ID,
        paint: {
          'circle-radius': ['get', 'radius'],
          'circle-color': ['get', 'colour'],
          // Solid, like before, so markers keep their exact colour; the
          // outline keeps overlapping ones apart.
          'circle-opacity': 1,
          'circle-stroke-color': [
            'case',
            ['get', 'selected'],
            '#ffffff',
            '#000000',
          ],
          'circle-stroke-width': ['case', ['get', 'selected'], 3, 1],
        },
      },
      // Below the camera clusters and pins, when they're already there.
      map.getLayer(CLUSTER_LAYER) === undefined ? undefined : CLUSTER_LAYER,
    );
    ready = true;
    draw();
  };
  if (map.isStyleLoaded() === true) {
    setUp();
  } else {
    map.once('load', setUp);
  }

  return {
    update(events, checkedAt, selected) {
      latest = earthquakePoints(events, checkedAt, selected);
      draw();
    },

    destroy() {
      map.off('load', setUp);
    },
  };
}
