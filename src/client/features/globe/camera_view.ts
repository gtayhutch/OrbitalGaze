/**
 * @fileoverview Where the globe's camera is and which way it looks.
 *
 * Layer: client feature (browser only). A plain data type with no Cesium
 * import, so share links can encode it without loading the globe's code.
 */

/** The camera's position and direction, in degrees and metres. */
export interface CameraView {
  /** Longitude in degrees, −180 to 180. */
  readonly lng: number;
  /** Latitude in degrees, −90 to 90. */
  readonly lat: number;
  /** Height above the ellipsoid, in metres. */
  readonly height: number;
  /** Compass heading in degrees, 0 (north) to 360. */
  readonly heading: number;
  /** Tilt in degrees: −90 looks straight down, 0 at the horizon. */
  readonly pitch: number;
}
