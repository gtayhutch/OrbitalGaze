/**
 * @fileoverview Creates and configures the MapLibre map behind the globe.
 *
 * Layer: client feature (browser only). Used by `globe_view.tsx`, which owns
 * the map's lifetime inside React.
 *
 * The map uses MapLibre's globe projection with the dark basemap style from
 * `basemap_style.ts`. MapLibre draws only when something changes, so a
 * still globe costs no battery. Its own controls and credit box are off,
 * because the app draws its own (`globe_controls.tsx`, and the credit strip
 * in `globe_view.tsx`).
 *
 * MapLibre parses tiles in web workers. Their script is bundled as a
 * separate file served from our origin (see `vite.config.ts`), so the
 * Content Security Policy needs no extra hosts.
 */
import 'maplibre-gl/dist/maplibre-gl.css';

import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {Map as MapLibreMap, setWorkerUrl} from 'maplibre-gl';

import {reportBrowserError} from '@/client/lib/error_reporting';

import {buildBaseStyle} from './basemap_style';
import {MAX_PITCH, MAX_ZOOM, type CameraView} from './camera_view';

/** Where the globe starts without a share link: the whole Earth. */
export const HOME_VIEW: CameraView = {
  lng: -40,
  lat: 25,
  zoom: 1.6,
  bearing: 0,
  pitch: 0,
};

/**
 * Highest device pixel ratio the map renders at. Phones with 3× screens
 * would otherwise draw 2.25 times as many pixels for little visible gain.
 */
const MAX_PIXEL_RATIO = 2;

/**
 * Creates the globe's map inside `container`.
 *
 * The caller owns the map and must call `map.remove()` when the container
 * goes away, or its WebGL context and workers leak.
 *
 * @param container The element the globe fills.
 * @param initialView Where the camera starts, for example from a share
 *     link; `null` starts at {@link HOME_VIEW}.
 * @returns The new map. Its style loads asynchronously (`load` event).
 * @throws {Error} If the browser can't create a WebGL context (for example,
 *     WebGL is disabled or the GPU is blocklisted).
 * @example
 * const map = createGlobeMap(element, null);
 * // later
 * map.remove();
 */
export function createGlobeMap(
  container: HTMLElement,
  initialView: CameraView | null,
): MapLibreMap {
  setWorkerUrl(workerUrl);
  const start = initialView ?? HOME_VIEW;
  const map = new MapLibreMap({
    container,
    style: buildBaseStyle(window.location.origin),
    center: [start.lng, start.lat],
    zoom: start.zoom,
    bearing: start.bearing,
    pitch: start.pitch,
    maxZoom: MAX_ZOOM,
    maxPitch: MAX_PITCH,
    pixelRatio: Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO),
    attributionControl: false,
    // Keyboard panning and zooming need the map to take focus; its
    // container is labelled for screen readers in `globe_view.tsx`.
    keyboard: true,
  });

  // Tile hiccups (a dropped connection) are retried by the next view change
  // and are only logged. Anything else, such as a broken style, is reported.
  map.on('error', event => {
    console.error('The globe hit a map error.', event.error);
    if (!('tile' in event)) {
      reportBrowserError('browser.globe-render', event.error);
    }
  });
  return map;
}
