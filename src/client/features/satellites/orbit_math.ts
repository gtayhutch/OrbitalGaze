/**
 * @fileoverview Small orbit facts and the ground footprint, from first principles.
 *
 * Layer: client feature (browser only). Pure functions, unit-tested; used by
 * the detail panel (period, orbit class) and the overlay (footprint).
 *
 * The Earth is treated as a sphere of mean radius here. That is plenty for
 * labels and a footprint outline; positions themselves come from SGP4 in the
 * orbit worker.
 */

/** Mean Earth radius, km. */
export const EARTH_RADIUS_KM = 6_371;

/** Earth's gravitational parameter, km³/s². */
const EARTH_MU = 398_600.4418;

/** Minutes in a day. */
const MINUTES_PER_DAY = 1_440;

/** Seconds in a day. */
const SECONDS_PER_DAY = 86_400;

/**
 * Low Earth orbit ends about 2,000 km up, which is an orbital period of
 * about 127 minutes.
 */
const LEO_MAX_PERIOD_MINUTES = 128;

/** A geosynchronous period is one sidereal day, give or take this much. */
const GEO_PERIOD_TOLERANCE_MINUTES = 30;

/** One sidereal day, in minutes. */
const SIDEREAL_DAY_MINUTES = 1_436.07;

/** Orbits more eccentric than this are "highly elliptical". */
const HIGHLY_ELLIPTICAL_ECCENTRICITY = 0.25;

/** The broad kind of orbit, as most references group them. */
export type OrbitClass = 'low' | 'medium' | 'geosynchronous' | 'elliptical';

/** Plain-language names for each orbit class. */
export const ORBIT_CLASS_LABELS: Readonly<Record<OrbitClass, string>> = {
  low: 'Low Earth orbit',
  medium: 'Medium Earth orbit',
  geosynchronous: 'Geosynchronous orbit',
  elliptical: 'Highly elliptical orbit',
};

/**
 * The time one orbit takes.
 *
 * @param meanMotion Revolutions per day.
 * @returns Minutes per revolution.
 * @example
 * periodMinutes(15.5); // ≈ 92.9 (the ISS)
 */
export function periodMinutes(meanMotion: number): number {
  return MINUTES_PER_DAY / meanMotion;
}

/**
 * The orbit's average distance from the Earth's centre.
 *
 * @param meanMotion Revolutions per day.
 * @returns Semi-major axis in km (Kepler's third law).
 */
export function semiMajorAxisKm(meanMotion: number): number {
  const radiansPerSecond = (meanMotion * 2 * Math.PI) / SECONDS_PER_DAY;
  return Math.cbrt(EARTH_MU / radiansPerSecond ** 2);
}

/**
 * The broad class of an orbit.
 *
 * @param meanMotion Revolutions per day.
 * @param eccentricity 0 for a circle, towards 1 for a long ellipse.
 * @returns The orbit class.
 * @example
 * orbitClass(15.5, 0.0004); // 'low'
 * orbitClass(1.0027, 0.0002); // 'geosynchronous'
 */
export function orbitClass(
  meanMotion: number,
  eccentricity: number,
): OrbitClass {
  if (eccentricity > HIGHLY_ELLIPTICAL_ECCENTRICITY) {
    return 'elliptical';
  }
  const period = periodMinutes(meanMotion);
  if (period < LEO_MAX_PERIOD_MINUTES) {
    return 'low';
  }
  if (Math.abs(period - SIDEREAL_DAY_MINUTES) <= GEO_PERIOD_TOLERANCE_MINUTES) {
    return 'geosynchronous';
  }
  return 'medium';
}

/**
 * How far over the ground a satellite can be seen: the distance from the
 * point beneath it to its horizon.
 *
 * @param altitudeKm Height above the surface.
 * @returns Ground distance in km; 0 at or below the surface.
 * @example
 * footprintRadiusKm(420); // ≈ 2,270 (the ISS)
 */
export function footprintRadiusKm(altitudeKm: number): number {
  if (altitudeKm <= 0) {
    return 0;
  }
  return (
    EARTH_RADIUS_KM *
    Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + altitudeKm))
  );
}

/** Degrees to radians. */
function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Radians to degrees. */
function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** A footprint outline, ready for the map. */
export interface FootprintRing {
  /** Closed ring of [lng, lat] points. Longitudes run on without jumping at ±180. */
  readonly ring: readonly (readonly [number, number])[];
  /**
   * True when the circle contains a pole: the ring is then only right as an
   * outline, not as a filled area.
   */
  readonly containsPole: boolean;
}

/**
 * The outline of a satellite's footprint: every point `radiusKm` away from
 * the point beneath it, along great circles.
 *
 * @param lng Longitude beneath the satellite, degrees.
 * @param lat Latitude beneath the satellite, degrees.
 * @param radiusKm Footprint radius (see {@link footprintRadiusKm}).
 * @param steps Points around the circle.
 * @returns The ring and whether it contains a pole.
 */
export function footprintRing(
  lng: number,
  lat: number,
  radiusKm: number,
  steps = 96,
): FootprintRing {
  const angular = radiusKm / EARTH_RADIUS_KM;
  const lat1 = toRadians(lat);
  const lng1 = toRadians(lng);
  const ring: [number, number][] = [];
  let previousLng = lng;
  for (let step = 0; step <= steps; step += 1) {
    const bearing = (2 * Math.PI * step) / steps;
    // Destination point along a great circle (spherical Earth).
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angular) +
        Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
    );
    const lng2 =
      lng1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
        Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
      );
    // Keep longitudes continuous so the outline never jumps across ±180.
    let pointLng = toDegrees(lng2);
    while (pointLng - previousLng > 180) pointLng -= 360;
    while (pointLng - previousLng < -180) pointLng += 360;
    previousLng = pointLng;
    ring.push([pointLng, toDegrees(lat2)]);
  }
  const containsPole = Math.abs(lat) + toDegrees(angular) >= 90;
  return {ring, containsPole};
}
