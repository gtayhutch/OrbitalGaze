/**
 * @fileoverview Messages between the page and the orbit worker.
 *
 * Layer: client feature (browser only). Types only, shared by
 * `orbit_worker.ts` and `use_satellites.ts`, so both sides agree on every
 * message's shape.
 */
import type {SatelliteGroup} from '@/shared/satellites';

/** What the page asks the worker to do. */
export type OrbitRequest =
  /**
   * Download and validate the snapshot, then build the orbit models. The
   * worker builds the snapshot's address itself, on its own origin.
   */
  | {readonly type: 'load'}
  /** Compute every position for this moment (ms since 1970). */
  | {readonly type: 'tick'; readonly time: number}
  /** Hide satellites outside these groups (they're skipped, not drawn). */
  | {readonly type: 'groups'; readonly groups: readonly SatelliteGroup[]}
  /** Follow one satellite (its live state and orbit path); `null` stops. */
  | {readonly type: 'select'; readonly id: number | null};

/** The light catalogue the page keeps (names for search, groups for counts). */
export interface OrbitCatalog {
  /** When the server last fetched the data (ISO 8601 UTC). */
  readonly checkedAt: string;
  readonly ids: readonly number[];
  readonly names: readonly string[];
  readonly intlDes: readonly string[];
  readonly groups: readonly SatelliteGroup[];
  readonly meanMotion: readonly number[];
  readonly eccentricity: readonly number[];
  readonly inclination: readonly number[];
  /** Element epochs (OMM, UTC). */
  readonly epochs: readonly string[];
}

/** The followed satellite's live state. */
export interface SelectedState {
  readonly id: number;
  readonly lng: number;
  readonly lat: number;
  readonly altitudeKm: number;
  readonly speedKmS: number;
}

/** What the worker sends back. */
export type OrbitResponse =
  | {readonly type: 'catalog'; readonly catalog: OrbitCatalog}
  | {readonly type: 'load-failed'; readonly notFound: boolean}
  | {
      readonly type: 'positions';
      /**
       * [lng, lat, altitude m] per satellite in catalogue order; hidden or
       * failed satellites are NaN, which deck.gl skips.
       */
      readonly positions: Float32Array;
      readonly selected: SelectedState | null;
      /** Milliseconds the worker spent computing. */
      readonly computeMs: number;
    }
  | {
      readonly type: 'path';
      readonly id: number;
      /** One orbit as [lng, lat, altitude m] triples, from now onwards. */
      readonly path: Float32Array;
    };
