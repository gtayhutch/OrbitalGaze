/**
 * @fileoverview Tests for turning cameras and earthquakes into map points.
 *
 * Layer: client tests.
 */
import {describe, expect, it} from 'vitest';

import {SAMPLE_INDEX} from '@/client/test_support/camera_fixtures';
import {CAMERA_CATEGORIES, type CameraCategory} from '@/shared/cameras';
import type {Earthquake} from '@/shared/earthquakes';

import {
  cameraPoints,
  categoryColourPairs,
  earthquakePoints,
  OLDER_EARTHQUAKE_COLOUR,
  RECENT_EARTHQUAKE_COLOUR,
} from './point_features';

const ALL_CATEGORIES: ReadonlySet<CameraCategory> = new Set(CAMERA_CATEGORIES);

/** Builds an earthquake with sensible defaults. */
function buildEarthquake(overrides: Partial<Earthquake> = {}): Earthquake {
  return {
    id: 'us7000abcd',
    place: '10 km N of Somewhere',
    lng: 142.3,
    lat: 38.1,
    depthKm: 10,
    magnitude: 4,
    occurredAt: '2026-11-19T11:30:00.000Z',
    ...overrides,
  };
}

describe('cameraPoints', () => {
  it('puts every visible camera in the clustered points, as lng/lat', () => {
    const {clustered, selected} = cameraPoints(
      SAMPLE_INDEX,
      ALL_CATEGORIES,
      null,
    );

    expect(clustered.features).toHaveLength(4);
    expect(selected.features).toEqual([]);
    expect(clustered.features[0]).toEqual({
      type: 'Feature',
      geometry: {type: 'Point', coordinates: [139.7454, 35.6586]},
      properties: {id: 'cam-1', category: 'landmark'},
    });
  });

  it('keeps the selected camera out of the clusters', () => {
    const {clustered, selected} = cameraPoints(
      SAMPLE_INDEX,
      ALL_CATEGORIES,
      'cam-2',
    );

    expect(clustered.features.map(f => f.properties['id'])).toEqual([
      'cam-1',
      'cam-3',
      'cam-4',
    ]);
    expect(selected.features.map(f => f.properties['id'])).toEqual(['cam-2']);
  });

  it('leaves out hidden categories, even for the selected camera', () => {
    const {clustered, selected} = cameraPoints(
      SAMPLE_INDEX,
      new Set<CameraCategory>(['beach']),
      'cam-2',
    );

    expect(clustered.features.map(f => f.properties['id'])).toEqual(['cam-4']);
    expect(selected.features).toEqual([]);
  });
});

describe('earthquakePoints', () => {
  const checkedAt = '2026-11-19T12:00:00.000Z';

  it('sizes markers by magnitude, within limits', () => {
    const points = earthquakePoints(
      [
        buildEarthquake({id: 'a', magnitude: 4}),
        buildEarthquake({id: 'b', magnitude: null}),
        buildEarthquake({id: 'c', magnitude: 9.5}),
      ],
      checkedAt,
      null,
    );

    // Diameter 6 + 2 × magnitude, capped at 24; the radius is half.
    expect(points.features.map(f => f.properties['radius'])).toEqual([
      7, 3, 12,
    ]);
  });

  it('colours the last hour amber and older events violet', () => {
    const points = earthquakePoints(
      [
        buildEarthquake({id: 'new', occurredAt: '2026-11-19T11:30:00.000Z'}),
        buildEarthquake({id: 'old', occurredAt: '2026-11-19T10:30:00.000Z'}),
      ],
      checkedAt,
      null,
    );

    expect(points.features.map(f => f.properties['colour'])).toEqual([
      RECENT_EARTHQUAKE_COLOUR,
      OLDER_EARTHQUAKE_COLOUR,
    ]);
  });

  it('marks only the selected earthquake', () => {
    const points = earthquakePoints(
      [buildEarthquake({id: 'a'}), buildEarthquake({id: 'b'})],
      checkedAt,
      'b',
    );

    expect(points.features.map(f => f.properties['selected'])).toEqual([
      false,
      true,
    ]);
  });
});

describe('categoryColourPairs', () => {
  it('alternates every category with its colour', () => {
    const pairs = categoryColourPairs(category => `colour-${category}`);

    expect(pairs).toHaveLength(CAMERA_CATEGORIES.length * 2);
    expect(pairs.slice(0, 2)).toEqual([
      CAMERA_CATEGORIES[0],
      `colour-${CAMERA_CATEGORIES[0]}`,
    ]);
  });
});
