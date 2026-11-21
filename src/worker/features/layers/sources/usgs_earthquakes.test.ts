/**
 * @fileoverview Tests the public projection and fixed USGS fetch path.
 */
import {expect, it, vi} from 'vitest';

import {buildWorkerConfig} from '../../../test_support/factories';
import {normalizeEarthquakeFeed, USGS_EARTHQUAKES} from './usgs_earthquakes';

/** One USGS feature with extra metadata that should stay upstream. */
function feature(id: string, time: number) {
  return {
    id,
    type: 'Feature',
    geometry: {type: 'Point', coordinates: [-120, 40, 12]},
    properties: {time, place: 'Near the coast', mag: 4.2, url: 'untrusted'},
  };
}

it('returns only validated fields, ordered newest first without duplicate IDs', () => {
  const first = feature('a', 1_700_000_000_000);
  const second = feature('b', 1_700_000_000_001);
  const result = normalizeEarthquakeFeed({
    type: 'FeatureCollection',
    features: [first, second, first, {id: 'invalid'}],
  });
  expect(result.map(event => event.id)).toEqual(['b', 'a']);
  expect(result[0]).toEqual({
    id: 'b',
    occurredAt: new Date(second.properties.time).toISOString(),
    place: 'Near the coast',
    magnitude: 4.2,
    lng: -120,
    lat: 40,
    depthKm: 12,
  });
});

it('rejects entirely malformed results so a previous snapshot can stay live', () => {
  expect(() =>
    normalizeEarthquakeFeed({type: 'FeatureCollection', features: [{}]}),
  ).toThrow();
  expect(
    normalizeEarthquakeFeed({type: 'FeatureCollection', features: []}),
  ).toEqual([]);
});

it('fetches only the USGS past-day summary', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(() =>
    Promise.resolve(
      Response.json({
        type: 'FeatureCollection',
        features: [feature('us1', 1_700_000_000_000)],
      }),
    ),
  );
  const result = await USGS_EARTHQUAKES.fetchItems({
    fetch,
    now: new Date(0),
    config: buildWorkerConfig(),
  });
  expect(result).toHaveLength(1);
  expect(fetch).toHaveBeenCalledTimes(1);
  const url = fetch.mock.calls[0]?.[0];
  expect(url instanceof URL ? url.href : url).toBe(
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
  );
});
