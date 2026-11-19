/**
 * @fileoverview Draws satellites at their real height over the globe.
 *
 * Layer: client feature (browser only). Loaded on demand by
 * `use_satellites.ts` when the satellites layer is switched on, so deck.gl
 * never weighs on the first globe load.
 *
 * Pattern: Bridge. deck.gl renders inside MapLibre's own frame through
 * `MapLibreOverlay` in interleaved mode, which shares MapLibre's depth
 * buffer: satellites behind the Earth are hidden by it. (Overlaid mode draws
 * on a separate canvas and shows them through the globe.)
 *
 * Layers, bottom to top:
 * - the footprint of the followed satellite: a MapLibre fill and outline on
 *   the ground, beneath the earthquakes and cameras;
 * - `satellites`: one dot per satellite from binary attributes, so 17,000
 *   positions update with one buffer upload and no per-point objects;
 * - `satellite-orbit`: the followed satellite's path for one orbit;
 * - `satellite-selected`: the followed satellite, larger with a white ring.
 *
 * The dots move, so clicks use a generous picking radius.
 */
import {PathLayer, ScatterplotLayer} from '@deck.gl/layers';
import {MapLibreOverlay} from '@deck.gl/maplibre';
import type {GeoJSONSource, Map as MapLibreMap} from 'maplibre-gl';

import type {SelectedState} from './orbit_protocol';
import {footprintRadiusKm, footprintRing} from './orbit_math';

/** MapLibre source and layer IDs for the footprint. */
const FOOTPRINT_SOURCE = 'satellite-footprint';
const FOOTPRINT_FILL = 'satellite-footprint-fill';
const FOOTPRINT_LINE = 'satellite-footprint-line';

/** Our ground layers the footprint goes beneath, if they're there. */
const GROUND_LAYERS_ABOVE = ['earthquakes', 'camera-clusters'];

/** How far from a dot, in CSS pixels, a click still selects it. */
const PICKING_RADIUS_PX = 8;

/** Dot radius in CSS pixels; the followed satellite is drawn larger. */
const DOT_RADIUS_PX = 2.5;
const SELECTED_RADIUS_PX = 6;

/** The orbit path's colour and width. */
const ORBIT_COLOUR: [number, number, number, number] = [255, 255, 255, 150];
const ORBIT_WIDTH_PX = 1.5;

/** Footprint colours. */
const FOOTPRINT_FILL_COLOUR = '#5eead4';
const FOOTPRINT_LINE_COLOUR = '#99f6e4';

/** What `use_satellites.ts` can do with the overlay. */
export interface SatelliteOverlay {
  /** Sets each satellite's RGBA colour (4 bytes each, catalogue order). */
  setColours(colours: Uint8Array): void;
  /** Draws a new set of positions ([lng, lat, metres] per satellite). */
  setPositions(positions: Float32Array): void;
  /** Draws the followed satellite and its footprint; `null` clears them. */
  setSelected(selected: SelectedState | null): void;
  /** Draws one orbit ([lng, lat, metres] triples); `null` clears it. */
  setPath(path: Float32Array | null): void;
  /** Removes everything from the map. */
  destroy(): void;
}

/** Turns a flat [lng, lat, z] array into deck.gl path points, skipping gaps. */
function pathPoints(path: Float32Array): [number, number, number][] {
  const points: [number, number, number][] = [];
  for (let index = 0; index + 2 < path.length; index += 3) {
    const lng = path[index] ?? Number.NaN;
    const lat = path[index + 1] ?? Number.NaN;
    const z = path[index + 2] ?? Number.NaN;
    if (Number.isFinite(lng) && Number.isFinite(lat) && Number.isFinite(z)) {
      points.push([lng, lat, z]);
    }
  }
  return points;
}

/** GeoJSON for the footprint, or an empty collection. */
function footprintGeoJson(
  selected: SelectedState | null,
): GeoJSON.FeatureCollection {
  if (selected === null) {
    return {type: 'FeatureCollection', features: []};
  }
  const {ring, containsPole} = footprintRing(
    selected.lng,
    selected.lat,
    footprintRadiusKm(selected.altitudeKm),
  );
  const coordinates = ring.map(([lng, lat]) => [lng, lat]);
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        // A circle around a pole can only be drawn honestly as an outline.
        properties: {fill: !containsPole},
        geometry: {type: 'Polygon', coordinates: [coordinates]},
      },
    ],
  };
}

/**
 * Adds the satellite overlay to a map whose style has loaded.
 *
 * @param map The globe's map; it must outlive the overlay.
 * @param onPick Called with a satellite's catalogue position when its dot
 *     is clicked.
 * @returns The overlay's controls.
 * @example
 * const overlay = createSatelliteOverlay(map, index => select(catalog.ids[index]));
 * overlay.setColours(colours);
 * overlay.setPositions(positions);
 */
export function createSatelliteOverlay(
  map: MapLibreMap,
  onPick: (index: number) => void,
): SatelliteOverlay {
  let colours: Uint8Array = new Uint8Array(0);
  let positions: Float32Array = new Float32Array(0);
  let selected: SelectedState | null = null;
  let path: [number, number, number][] = [];

  const overlay = new MapLibreOverlay({
    interleaved: true,
    pickingRadius: PICKING_RADIUS_PX,
    layers: [],
  });
  map.addControl(overlay);

  // The footprint lies on the ground, so it is a MapLibre layer under ours.
  const beforeId = GROUND_LAYERS_ABOVE.find(
    id => map.getLayer(id) !== undefined,
  );
  map.addSource(FOOTPRINT_SOURCE, {
    type: 'geojson',
    data: footprintGeoJson(null),
  });
  map.addLayer(
    {
      id: FOOTPRINT_FILL,
      type: 'fill',
      source: FOOTPRINT_SOURCE,
      filter: ['==', ['get', 'fill'], true],
      paint: {'fill-color': FOOTPRINT_FILL_COLOUR, 'fill-opacity': 0.12},
    },
    beforeId,
  );
  map.addLayer(
    {
      id: FOOTPRINT_LINE,
      type: 'line',
      source: FOOTPRINT_SOURCE,
      paint: {
        'line-color': FOOTPRINT_LINE_COLOUR,
        'line-width': 1.5,
        'line-opacity': 0.7,
      },
    },
    beforeId,
  );

  /** Rebuilds the deck.gl layers from the current state. */
  const render = (): void => {
    const count = Math.min(colours.length / 4, positions.length / 3);
    overlay.setProps({
      layers: [
        new ScatterplotLayer({
          id: 'satellites',
          data: {
            length: count,
            attributes: {
              getPosition: {value: positions, size: 3},
              getFillColor: {value: colours, size: 4, normalized: true},
            },
          },
          billboard: true,
          radiusUnits: 'pixels',
          getRadius: DOT_RADIUS_PX,
          pickable: true,
          autoHighlight: true,
          highlightColor: [255, 255, 255, 255],
          onClick: info => {
            if (info.index >= 0) {
              onPick(info.index);
            }
            return true;
          },
        }),
        new PathLayer<[number, number, number][]>({
          id: 'satellite-orbit',
          data: path.length > 1 ? [path] : [],
          getPath: points => points,
          getColor: ORBIT_COLOUR,
          widthUnits: 'pixels',
          getWidth: ORBIT_WIDTH_PX,
          // Seen from some angles on the globe, culled faces would hide it.
          parameters: {cullMode: 'none'},
        }),
        new ScatterplotLayer<SelectedState>({
          id: 'satellite-selected',
          data: selected === null ? [] : [selected],
          getPosition: s => [s.lng, s.lat, s.altitudeKm * 1_000],
          billboard: true,
          radiusUnits: 'pixels',
          getRadius: SELECTED_RADIUS_PX,
          getFillColor: [255, 255, 255, 255],
          stroked: true,
          lineWidthUnits: 'pixels',
          getLineWidth: 2,
          getLineColor: [15, 118, 110, 255],
        }),
      ],
    });
  };

  return {
    setColours(next) {
      colours = next;
      render();
    },

    setPositions(next) {
      positions = next;
      render();
    },

    setSelected(next) {
      selected = next;
      // Nothing waits for the map's workers to finish.
      void map
        .getSource<GeoJSONSource>(FOOTPRINT_SOURCE)
        ?.setData(footprintGeoJson(next));
      render();
    },

    setPath(next) {
      path = next === null ? [] : pathPoints(next);
      render();
    },

    destroy() {
      map.removeControl(overlay);
      overlay.finalize();
      for (const layer of [FOOTPRINT_LINE, FOOTPRINT_FILL]) {
        if (map.getLayer(layer) !== undefined) {
          map.removeLayer(layer);
        }
      }
      if (map.getSource(FOOTPRINT_SOURCE) !== undefined) {
        map.removeSource(FOOTPRINT_SOURCE);
      }
    },
  };
}
