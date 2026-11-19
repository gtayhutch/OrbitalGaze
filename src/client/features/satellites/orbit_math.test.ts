/**
 * @fileoverview Tests for the orbit facts and the footprint outline.
 *
 * Layer: client tests.
 */
import {describe, expect, it} from 'vitest';

import {
  EARTH_RADIUS_KM,
  footprintRadiusKm,
  footprintRing,
  orbitClass,
  periodMinutes,
  semiMajorAxisKm,
} from './orbit_math';

/** Great-circle distance between two points on the spherical Earth, km. */
function distanceKm(
  [lng1, lat1]: readonly [number, number],
  [lng2, lat2]: readonly [number, number],
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

describe('periodMinutes and semiMajorAxisKm', () => {
  it('match the ISS and a geostationary satellite', () => {
    expect(periodMinutes(15.5)).toBeCloseTo(92.9, 1);
    // A geostationary orbit is about 42,164 km from the Earth's centre.
    expect(semiMajorAxisKm(1.0027)).toBeCloseTo(42_164, -2);
  });
});

describe('orbitClass', () => {
  it.each([
    [15.5, 0.0004, 'low'],
    [2.005, 0.001, 'medium'],
    [1.0027, 0.0002, 'geosynchronous'],
    [2.006, 0.7, 'elliptical'],
  ] as const)('classes %d rev/day, e=%d as %s', (meanMotion, ecc, expected) => {
    expect(orbitClass(meanMotion, ecc)).toBe(expected);
  });
});

describe('footprintRadiusKm', () => {
  it('grows with height and is zero on the ground', () => {
    expect(footprintRadiusKm(0)).toBe(0);
    expect(footprintRadiusKm(-5)).toBe(0);
    expect(footprintRadiusKm(420)).toBeCloseTo(2_270, -2);
    expect(footprintRadiusKm(35_786)).toBeGreaterThan(9_000);
  });
});

describe('footprintRing', () => {
  it('puts every point at the footprint radius from the centre', () => {
    const {ring, containsPole} = footprintRing(10, 45, 1_000, 24);

    expect(containsPole).toBe(false);
    expect(ring).toHaveLength(25);
    // Closed: the last point repeats the first (up to rounding).
    expect(ring[24]?.[0]).toBeCloseTo(ring[0]?.[0] ?? Number.NaN, 9);
    expect(ring[24]?.[1]).toBeCloseTo(ring[0]?.[1] ?? Number.NaN, 9);
    for (const point of ring) {
      expect(distanceKm([10, 45], point)).toBeCloseTo(1_000, -1);
    }
  });

  it('keeps longitudes continuous across the antimeridian', () => {
    const {ring} = footprintRing(179, 0, 2_000, 48);

    for (let i = 1; i < ring.length; i += 1) {
      const step = Math.abs((ring[i]?.[0] ?? 0) - (ring[i - 1]?.[0] ?? 0));
      expect(step).toBeLessThan(10);
    }
  });

  it('flags a footprint that contains a pole', () => {
    expect(footprintRing(0, 80, 2_500).containsPole).toBe(true);
    expect(footprintRing(0, 0, 2_500).containsPole).toBe(false);
  });
});
