/**
 * @fileoverview Tests for sorting satellites into display groups.
 *
 * Layer: worker tests (pure).
 */
import {describe, expect, it} from 'vitest';

import {classifySatellite} from './satellite_classification';

/** A low, circular orbit unless overridden. */
function satellite(
  name: string,
  overrides: Partial<{
    id: number;
    meanMotion: number;
    eccentricity: number;
    inclination: number;
  }> = {},
) {
  return {
    id: 99_999,
    name,
    meanMotion: 15.2,
    eccentricity: 0.001,
    inclination: 53,
    ...overrides,
  };
}

describe('classifySatellite', () => {
  it.each([
    ['ISS (ZARYA)', {id: 25544}, 'stations'],
    ['CSS (TIANHE)', {id: 48274}, 'stations'],
    ['STARLINK-1007', {}, 'starlink'],
    ['ONEWEB-0012', {}, 'internet'],
    ['KUIPER-00010', {}, 'internet'],
    [
      'NAVSTAR 81 (USA 319)',
      {meanMotion: 2.005, inclination: 55},
      'navigation',
    ],
    ['GSAT0219 (GALILEO 23)', {meanMotion: 1.7, inclination: 56}, 'navigation'],
    ['BEIDOU-3 M21', {meanMotion: 1.86, inclination: 55}, 'navigation'],
    ['NOAA 20 (JPSS-1)', {meanMotion: 14.2, inclination: 98.7}, 'weather'],
    ['SENTINEL-2B', {meanMotion: 14.3, inclination: 98.6}, 'weather'],
    ['HST', {id: 20580, meanMotion: 15.1, inclination: 28.5}, 'science'],
    [
      'INTELSAT 901',
      {meanMotion: 1.0027, eccentricity: 0.0002, inclination: 0.05},
      'geostationary',
    ],
    ['SOMESAT 1', {}, 'other'],
  ] as const)('puts %s in %s', (name, overrides, expected) => {
    expect(classifySatellite(satellite(name, overrides))).toBe(expected);
  });

  it('recognises GLONASS satellites by orbit, since they are named COSMOS', () => {
    expect(
      classifySatellite(
        satellite('COSMOS 2424 (GLONASS)', {
          meanMotion: 2.13,
          eccentricity: 0.001,
          inclination: 64.8,
        }),
      ),
    ).toBe('navigation');
    expect(
      classifySatellite(
        satellite('COSMOS 2560', {
          meanMotion: 2.13,
          eccentricity: 0.0005,
          inclination: 64.9,
        }),
      ),
    ).toBe('navigation');
  });

  it('keeps a COSMOS satellite in low orbit out of navigation', () => {
    expect(classifySatellite(satellite('COSMOS 2558'))).toBe('other');
  });

  it('does not call an eccentric one-day orbit geostationary', () => {
    expect(
      classifySatellite(
        satellite('SOMESAT 2', {meanMotion: 1.0, eccentricity: 0.3}),
      ),
    ).toBe('other');
  });
});
