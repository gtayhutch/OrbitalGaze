/**
 * @fileoverview Tests for clustering markers that would overlap on screen.
 *
 * Layer: client tests.
 */
import {describe, expect, it} from 'vitest';

import {
  clusterPoints,
  type ClusterPoint,
  type ScreenPosition,
} from './grid_cluster';

/** A point with a map position and a screen position (or none). */
interface TestPoint extends ClusterPoint {
  readonly screen: ScreenPosition | null;
}

/** Builds a test point. */
function point(
  id: string,
  screen: ScreenPosition | null,
  lat = 0,
  lng = 0,
): TestPoint {
  return {id, lat, lng, screen};
}

/** Options shared by the tests: a 50 px radius. */
const OPTIONS = {
  positionOf: (candidate: TestPoint) => candidate.screen,
  pixelRange: 50,
} as const;

/** Three points whose markers would overlap. */
const TOKYO = [
  point('t1', {x: 100, y: 100}, 35.6, 139.7),
  point('t2', {x: 120, y: 110}, 35.7, 139.8),
  point('t3', {x: 130, y: 130}, 35.65, 139.75),
];

describe('clusterPoints', () => {
  it('merges overlapping markers into one cluster at their average position', () => {
    const {singles, clusters} = clusterPoints(TOKYO, OPTIONS);

    expect(singles).toEqual([]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({key: 't1', ids: ['t1', 't2', 't3']});
    expect(clusters[0]?.lat).toBeCloseTo(35.65);
    expect(clusters[0]?.lng).toBeCloseTo(139.75);
  });

  it('groups points that sit either side of a grid square edge', () => {
    // 49 and 51 fall in different 50 px squares but are 2 px apart.
    const {clusters} = clusterPoints(
      [
        point('a', {x: 49, y: 10}),
        point('b', {x: 51, y: 10}),
        point('c', {x: 52, y: 12}),
      ],
      OPTIONS,
    );

    expect(clusters[0]?.ids).toEqual(['a', 'b', 'c']);
  });

  it('keeps markers single when too few overlap', () => {
    const {singles, clusters} = clusterPoints(
      [...TOKYO, point('paris', {x: 400, y: 90})],
      OPTIONS,
    );

    expect(clusters).toHaveLength(1);
    expect(singles.map(single => single.id)).toEqual(['paris']);
  });

  it('only groups points within the pixel range of each other', () => {
    const {clusters, singles} = clusterPoints(
      [
        point('a', {x: 0, y: 0}),
        point('b', {x: 40, y: 0}),
        point('c', {x: 80, y: 0}),
      ],
      OPTIONS,
    );

    // c is 80 px from a, outside the 50 px radius, so no group of three forms.
    expect(clusters).toEqual([]);
    expect(singles).toHaveLength(3);
  });

  it('never merges a kept point, such as the selected camera', () => {
    const {singles, clusters} = clusterPoints(TOKYO, {
      ...OPTIONS,
      keepIds: new Set(['t2']),
    });

    // The kept point comes first; the other two are below the minimum.
    expect(singles.map(single => single.id)).toEqual(['t2', 't1', 't3']);
    expect(clusters).toEqual([]);
  });

  it('keeps points without a screen position single, such as ones behind the Earth', () => {
    const hidden = [point('h1', null), point('h2', null), point('h3', null)];

    const {singles, clusters} = clusterPoints(hidden, OPTIONS);

    expect(singles).toHaveLength(3);
    expect(clusters).toEqual([]);
  });

  it('honours a custom minimum cluster size', () => {
    const {clusters} = clusterPoints(TOKYO.slice(0, 2), {
      ...OPTIONS,
      minClusterSize: 2,
    });

    expect(clusters[0]?.ids).toEqual(['t1', 't2']);
  });

  it('accounts for every point exactly once', () => {
    const points = Array.from({length: 500}, (_, index) =>
      point(`p${String(index)}`, {
        x: (index * 37) % 800,
        y: (index * 53) % 600,
      }),
    );

    const {singles, clusters} = clusterPoints(points, OPTIONS);
    const seen = [
      ...singles.map(single => single.id),
      ...clusters.flatMap(cluster => cluster.ids),
    ];

    expect(seen.sort()).toEqual(points.map(p => p.id).sort());
  });
});
