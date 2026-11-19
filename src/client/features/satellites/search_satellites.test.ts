/**
 * @fileoverview Tests for finding satellites by name or catalogue number.
 *
 * Layer: client tests.
 */
import {describe, expect, it} from 'vitest';

import {searchSatellites} from './search_satellites';

const INDEX = {
  ids: [20580, 25544, 44713, 48274, 49260],
  names: [
    'HUBBLE',
    'ISS (ZARYA)',
    'STARLINK-1007',
    'CSS (TIANHE)',
    'MISSION X',
  ],
};

describe('searchSatellites', () => {
  it('ranks names that start with the query before names that contain it', () => {
    // "ISS (ZARYA)" starts with ISS; "MISSION X" only contains it.
    expect(searchSatellites('iss', INDEX, 5)).toEqual([1, 4]);
  });

  it('finds an exact catalogue number first', () => {
    expect(searchSatellites('25544', INDEX, 5)).toEqual([1]);
  });

  it('ignores case and surrounding spaces', () => {
    expect(searchSatellites('  starlink ', INDEX, 5)).toEqual([2]);
  });

  it('respects the limit', () => {
    expect(searchSatellites('s', INDEX, 1)).toEqual([]);
    expect(searchSatellites('ss', INDEX, 1)).toHaveLength(1);
  });

  it('returns nothing for an empty or unmatched query', () => {
    expect(searchSatellites('', INDEX, 5)).toEqual([]);
    expect(searchSatellites('zzz', INDEX, 5)).toEqual([]);
  });
});
