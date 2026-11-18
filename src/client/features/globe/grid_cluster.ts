/**
 * @fileoverview Groups map points whose markers would overlap on screen.
 *
 * Layer: client feature (browser only). Pure functions, no Cesium, so they
 * run in unit tests and any point layer can reuse them.
 *
 * How it works (neighbourhood clustering on a screen grid):
 * 1. The caller gives each point's screen position (`positionOf`), or
 *    `null` for points that aren't on screen (for example on the far side
 *    of the Earth). Those, and points in `keepIds` such as the selected
 *    camera, stay single.
 * 2. Placed points go into a grid of `pixelRange`-sized squares. The grid is
 *    only an index: it finds a point's neighbours by checking its own
 *    square and the eight around it, so the work grows linearly with the
 *    number of points.
 * 3. Points are visited in order. Each point not yet grouped gathers every
 *    ungrouped point within `pixelRange` pixels of it (itself included). If
 *    that's at least `minClusterSize` points, they become one cluster at
 *    their average map position. Otherwise the point stays single, and its
 *    neighbours wait for their own turn.
 *
 * Unlike plain grid cells, two points just either side of a square's edge
 * still group together, so cluster markers rarely overlap.
 */

/** A point to cluster. */
export interface ClusterPoint {
  /** Unique identifier, for example a camera ID. */
  readonly id: string;
  /** Latitude in degrees, −90 to 90. */
  readonly lat: number;
  /** Longitude in degrees, −180 to 180. */
  readonly lng: number;
}

/** A position on screen, in CSS pixels. */
export interface ScreenPosition {
  readonly x: number;
  readonly y: number;
}

/** Several points merged into one marker. */
export interface PointCluster {
  /** Stable identifier: the ID of the point the cluster grew from. */
  readonly key: string;
  /** The IDs of the points in the cluster. */
  readonly ids: readonly string[];
  /** Average latitude of the points. */
  readonly lat: number;
  /** Average longitude of the points. */
  readonly lng: number;
}

/** The result of {@link clusterPoints}. */
export interface ClusterResult<Point extends ClusterPoint> {
  /** Points shown on their own. */
  readonly singles: readonly Point[];
  /** Groups of points shown as one numbered marker. */
  readonly clusters: readonly PointCluster[];
}

/** Options for {@link clusterPoints}. */
export interface ClusterOptions<Point extends ClusterPoint> {
  /** A point's screen position, or `null` to keep it single. */
  readonly positionOf: (point: Point) => ScreenPosition | null;
  /** Points closer than this many CSS pixels can join one cluster. */
  readonly pixelRange: number;
  /** Fewest points that form a cluster; defaults to 3. */
  readonly minClusterSize?: number;
  /** Points that always stay single, such as the selected one. */
  readonly keepIds?: ReadonlySet<string>;
}

/** Default smallest cluster. */
const DEFAULT_MIN_CLUSTER_SIZE = 3;

/** A point with its screen position and grid square. */
interface PlacedPoint<Point> {
  readonly point: Point;
  readonly x: number;
  readonly y: number;
  readonly column: number;
  readonly row: number;
}

/** The grid key for a square. */
function squareKey(column: number, row: number): string {
  return `${String(column)}:${String(row)}`;
}

/** The average map position of some points. */
function averagePosition(points: readonly ClusterPoint[]): {
  lat: number;
  lng: number;
} {
  let latSum = 0;
  let lngSum = 0;
  for (const point of points) {
    latSum += point.lat;
    lngSum += point.lng;
  }
  return {lat: latSum / points.length, lng: lngSum / points.length};
}

/**
 * Splits points into singles and clusters of markers that would overlap.
 *
 * @param points The points to group, in a stable order.
 * @param options Screen positions, the grouping radius, the smallest
 *     cluster, and points to keep single.
 * @returns Singles and clusters. Every input point appears exactly once,
 *     either as a single or inside one cluster.
 * @example
 * const {singles, clusters} = clusterPoints(cameras, {
 *   positionOf: camera => projectToScreen(camera),
 *   pixelRange: 56,
 * });
 */
export function clusterPoints<Point extends ClusterPoint>(
  points: readonly Point[],
  options: ClusterOptions<Point>,
): ClusterResult<Point> {
  const {positionOf, pixelRange, keepIds} = options;
  const minClusterSize = options.minClusterSize ?? DEFAULT_MIN_CLUSTER_SIZE;
  const rangeSquared = pixelRange * pixelRange;

  // Step 1: place each point in the grid index; unplaceable and kept points
  // are single straight away.
  const singles: Point[] = [];
  const placed: PlacedPoint<Point>[] = [];
  const square = new Map<string, number[]>();
  for (const point of points) {
    const position = keepIds?.has(point.id) === true ? null : positionOf(point);
    if (position === null) {
      singles.push(point);
      continue;
    }
    const column = Math.floor(position.x / pixelRange);
    const row = Math.floor(position.y / pixelRange);
    const key = squareKey(column, row);
    const members = square.get(key) ?? [];
    members.push(placed.length);
    square.set(key, members);
    placed.push({point, x: position.x, y: position.y, column, row});
  }

  // Step 2: grow a cluster from each ungrouped point, looking only in its
  // own square and the eight around it.
  const grouped = new Array<boolean>(placed.length).fill(false);
  const clusters: PointCluster[] = [];
  placed.forEach((seed, seedIndex) => {
    if (grouped[seedIndex] === true) {
      return;
    }
    const neighbours: number[] = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const index of square.get(
          squareKey(seed.column + dx, seed.row + dy),
        ) ?? []) {
          const other = placed[index];
          if (other === undefined || grouped[index] === true) {
            continue;
          }
          const distanceSquared =
            (other.x - seed.x) ** 2 + (other.y - seed.y) ** 2;
          if (distanceSquared <= rangeSquared) {
            neighbours.push(index);
          }
        }
      }
    }
    if (neighbours.length < minClusterSize) {
      grouped[seedIndex] = true;
      singles.push(seed.point);
      return;
    }
    const members = neighbours.map(index => {
      grouped[index] = true;
      // Safe: every index in the grid points into `placed`.
      return (placed[index] as PlacedPoint<Point>).point;
    });
    clusters.push({
      key: seed.point.id,
      ids: members.map(member => member.id),
      ...averagePosition(members),
    });
  });
  return {singles, clusters};
}
