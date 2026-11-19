/**
 * @fileoverview Where the globe's camera is and which way it looks.
 *
 * Layer: client feature (browser only). A plain data type with no map
 * library import, so share links can encode it without loading the globe's
 * code.
 */

/** The camera's position and direction, in MapLibre's terms. */
export interface CameraView {
  /** Longitude of the view's centre in degrees, −180 to 180. */
  readonly lng: number;
  /** Latitude of the view's centre in degrees, −90 to 90. */
  readonly lat: number;
  /** Map zoom level: about 1.5 shows the whole Earth, 11 a city, 15 streets. */
  readonly zoom: number;
  /** Compass bearing in degrees, 0 (north up) to 360. */
  readonly bearing: number;
  /** Tilt in degrees: 0 looks straight down, up to 85 towards the horizon. */
  readonly pitch: number;
}

/** Deepest zoom the globe allows (the basemap stops adding detail at 15). */
export const MAX_ZOOM = 20;

/** Largest tilt the globe allows, in degrees. */
export const MAX_PITCH = 85;
