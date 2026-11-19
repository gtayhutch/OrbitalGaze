/**
 * @fileoverview Hook that runs the satellites layer: data, motion and drawing.
 *
 * Layer: client feature (browser only). Used by the app shell.
 *
 * While the layer is on it:
 * 1. starts the orbit worker (`orbit_worker.ts`), which downloads and
 *    validates the snapshot and builds the orbit models off the main thread,
 *    and reloads it every hour;
 * 2. loads the deck.gl overlay (`satellite_overlay.ts`) on demand, so the
 *    first globe load never carries deck.gl;
 * 3. asks the worker for positions once a second (four times a second when
 *    zoomed in, where movement is visible), only while the tab is visible;
 * 4. follows the selected satellite: its live state for the detail panel,
 *    its orbit path and its footprint.
 *
 * Switching the layer off terminates the worker and removes the overlay, so
 * nothing keeps running.
 */
import type {Map as MapLibreMap} from 'maplibre-gl';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {reportBrowserError} from '@/client/lib/error_reporting';
import {prefersReducedMotion} from '@/client/lib/motion';
import {layerSnapshotPath} from '@/client/lib/use_layer_snapshot';
import {
  SATELLITE_GROUPS,
  SATELLITE_LAYER_ID,
  type SatelliteGroup,
} from '@/shared/satellites';

import type {
  OrbitCatalog,
  OrbitRequest,
  OrbitResponse,
  SelectedState,
} from './orbit_protocol';
import type {SatelliteOverlay} from './satellite_overlay';
import {SATELLITE_GROUP_STYLES} from './satellite_groups';

/** Wait between position updates, in milliseconds. */
const TICK_MS = 1_000;

/** Faster updates once zoomed in this far, where satellites visibly move. */
const FAST_TICK_ZOOM = 6;
const FAST_TICK_MS = 250;

/** How often the snapshot is reloaded (the server refreshes every 6 hours). */
const RELOAD_MS = 60 * 60_000;

/** Dot opacity, 0–255. */
const DOT_ALPHA = 235;

/** Flight duration to a satellite, in milliseconds (0 with reduced motion). */
const FLY_MS = 2_000;

/** The layer's state as the screen sees it. */
export type SatellitesState =
  | {readonly status: 'off' | 'loading' | 'unavailable' | 'error'}
  | {
      readonly status: 'ready';
      readonly catalog: OrbitCatalog;
      /** How many satellites each group has. */
      readonly counts: Readonly<Record<SatelliteGroup, number>>;
    };

/** The followed satellite, as the detail panel needs it. */
export interface FollowedSatellite {
  /** Its position in the catalogue. */
  readonly index: number;
  /** Its live state; `null` until the first update (or if SGP4 fails). */
  readonly live: SelectedState | null;
}

/** What {@link useSatellites} returns. */
export interface UseSatellitesResult {
  readonly state: SatellitesState;
  /** The followed satellite, or `null`. */
  readonly followed: FollowedSatellite | null;
  /**
   * Flies the globe to a satellite (normally the followed one): now if its
   * position is known, otherwise as soon as an update carries it.
   */
  readonly flyToSatellite: (id: number) => void;
}

/** Options for {@link useSatellites}. */
export interface UseSatellitesOptions {
  /** True while the layer is on. */
  readonly enabled: boolean;
  /** The globe's map, once it has loaded. */
  readonly map: MapLibreMap | null;
  /** Groups whose satellites are drawn. */
  readonly visibleGroups: ReadonlySet<SatelliteGroup>;
  /** The followed satellite's NORAD number (from the URL), or `null`. */
  readonly selectedId: number | null;
  /** Called with a NORAD number when a satellite's dot is clicked. */
  readonly onSelect: (id: number) => void;
}

/** Counts satellites per group. */
function countGroups(
  groups: readonly SatelliteGroup[],
): Record<SatelliteGroup, number> {
  const counts = Object.fromEntries(
    SATELLITE_GROUPS.map(group => [group, 0]),
  ) as Record<SatelliteGroup, number>;
  for (const group of groups) {
    counts[group] += 1;
  }
  return counts;
}

/** RGBA bytes per satellite, from its group's colour. */
function groupColours(groups: readonly SatelliteGroup[]): Uint8Array {
  const colours = new Uint8Array(groups.length * 4);
  groups.forEach((group, index) => {
    const [r, g, b] = SATELLITE_GROUP_STYLES[group].rgb;
    colours.set([r, g, b, DOT_ALPHA], index * 4);
  });
  return colours;
}

/** A zoom that shows a satellite at this height in context. */
function zoomForAltitude(altitudeKm: number): number {
  if (altitudeKm < 2_000) return 3.5;
  if (altitudeKm < 25_000) return 1.8;
  return 1;
}

/** Flies the map to a satellite's current position. */
function flyTo(map: MapLibreMap, where: SelectedState): void {
  map.flyTo({
    center: [where.lng, where.lat],
    zoom: zoomForAltitude(where.altitudeKm),
    duration: prefersReducedMotion() ? 0 : FLY_MS,
    essential: true,
  });
}

/**
 * Runs the satellites layer.
 *
 * @param options What to show and where.
 * @returns The layer's state, the followed satellite, and a fly-to action.
 * @example
 * const satellites = useSatellites({enabled, map, visibleGroups, selectedId, onSelect});
 */
export function useSatellites({
  enabled,
  map,
  visibleGroups,
  selectedId,
  onSelect,
}: UseSatellitesOptions): UseSatellitesResult {
  // What the worker last reported; `null` until it reports (loading), and
  // reset when the layer goes off.
  const [loaded, setLoaded] = useState<Exclude<
    SatellitesState,
    {readonly status: 'off' | 'loading'}
  > | null>(null);
  const [live, setLive] = useState<SelectedState | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const overlayRef = useRef<SatelliteOverlay | null>(null);
  const catalogRef = useRef<OrbitCatalog | null>(null);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  // Read by the worker effect without restarting it.
  const visibleRef = useRef(visibleGroups);
  const selectedRef = useRef(selectedId);
  // Set by `flyTo` when that satellite's position isn't known yet; the first
  // update that carries it flies there.
  const pendingFlyRef = useRef<number | null>(null);

  /** Sends a request to the worker, if it is running. */
  const post = useCallback((request: OrbitRequest) => {
    workerRef.current?.postMessage(request);
  }, []);

  // Step 1–4: the worker, the overlay and the tick loop, while on.
  useEffect(() => {
    if (!enabled || map === null) {
      return undefined;
    }
    let disposed = false;
    let tickTimer: number | undefined;
    const worker = new Worker(new URL('./orbit_worker.ts', import.meta.url), {
      type: 'module',
      name: 'orbits',
    });
    workerRef.current = worker;
    const overlayReady = import('./satellite_overlay').then(module => {
      if (disposed) {
        return null;
      }
      const overlay = module.createSatelliteOverlay(map, index => {
        const id = catalogRef.current?.ids[index];
        if (id !== undefined) {
          onSelectRef.current(id);
        }
      });
      overlayRef.current = overlay;
      return overlay;
    });

    /** Asks for the next positions after a pause, unless the tab is hidden. */
    const scheduleTick = (): void => {
      window.clearTimeout(tickTimer);
      if (disposed || document.visibilityState === 'hidden') {
        return;
      }
      const wait = map.getZoom() >= FAST_TICK_ZOOM ? FAST_TICK_MS : TICK_MS;
      tickTimer = window.setTimeout(() => {
        worker.postMessage({
          type: 'tick',
          time: Date.now(),
        } satisfies OrbitRequest);
      }, wait);
    };
    const resumeWhenVisible = (): void => {
      if (
        document.visibilityState === 'visible' &&
        catalogRef.current !== null
      ) {
        worker.postMessage({
          type: 'tick',
          time: Date.now(),
        } satisfies OrbitRequest);
      }
    };
    document.addEventListener('visibilitychange', resumeWhenVisible);

    worker.onmessage = (event: MessageEvent<OrbitResponse>) => {
      const message = event.data;
      switch (message.type) {
        case 'catalog': {
          const firstLoad = catalogRef.current === null;
          catalogRef.current = message.catalog;
          setLoaded({
            status: 'ready',
            catalog: message.catalog,
            counts: countGroups(message.catalog.groups),
          });
          void overlayReady.then(overlay => {
            overlay?.setColours(groupColours(message.catalog.groups));
          });
          worker.postMessage({
            type: 'groups',
            groups: [...visibleRef.current],
          } satisfies OrbitRequest);
          worker.postMessage({
            type: 'select',
            id: selectedRef.current,
          } satisfies OrbitRequest);
          if (firstLoad) {
            worker.postMessage({
              type: 'tick',
              time: Date.now(),
            } satisfies OrbitRequest);
          }
          break;
        }
        case 'load-failed':
          if (catalogRef.current === null) {
            setLoaded({status: message.notFound ? 'unavailable' : 'error'});
          }
          break;
        case 'positions':
          void overlayReady.then(overlay => {
            overlay?.setPositions(message.positions);
            overlay?.setSelected(message.selected);
          });
          setLive(message.selected);
          if (
            message.selected !== null &&
            message.selected.id === pendingFlyRef.current
          ) {
            pendingFlyRef.current = null;
            flyTo(map, message.selected);
          }
          scheduleTick();
          break;
        case 'path':
          if (message.id === selectedRef.current) {
            void overlayReady.then(overlay => {
              overlay?.setPath(message.path);
            });
          }
          break;
      }
    };
    worker.onerror = event => {
      console.error('The orbit worker failed.', event.message);
      reportBrowserError('browser.unhandled', new Error(event.message));
      if (catalogRef.current === null) {
        setLoaded({status: 'error'});
      }
    };

    const url = `${window.location.origin}${layerSnapshotPath(SATELLITE_LAYER_ID)}`;
    worker.postMessage({type: 'load', url} satisfies OrbitRequest);
    const reloadTimer = window.setInterval(() => {
      worker.postMessage({type: 'load', url} satisfies OrbitRequest);
    }, RELOAD_MS);

    return () => {
      disposed = true;
      window.clearTimeout(tickTimer);
      window.clearInterval(reloadTimer);
      document.removeEventListener('visibilitychange', resumeWhenVisible);
      worker.terminate();
      workerRef.current = null;
      catalogRef.current = null;
      overlayRef.current?.destroy();
      overlayRef.current = null;
      setLoaded(null);
      setLive(null);
    };
  }, [enabled, map]);

  // Group filter changes.
  useEffect(() => {
    visibleRef.current = visibleGroups;
    post({type: 'groups', groups: [...visibleGroups]});
  }, [visibleGroups, post]);

  // Following another satellite (or none).
  useEffect(() => {
    selectedRef.current = selectedId;
    post({type: 'select', id: selectedId});
    overlayRef.current?.setPath(null);
    if (selectedId === null) {
      overlayRef.current?.setSelected(null);
    }
  }, [selectedId, post]);

  let state: SatellitesState;
  if (!enabled || map === null) {
    state = {status: 'off'};
  } else {
    state = loaded ?? {status: 'loading'};
  }
  const catalog = state.status === 'ready' ? state.catalog : null;
  const followed = useMemo((): FollowedSatellite | null => {
    if (catalog === null || selectedId === null) {
      return null;
    }
    const index = catalog.ids.indexOf(selectedId);
    if (index === -1) {
      return null;
    }
    return {index, live: live?.id === selectedId ? live : null};
  }, [catalog, selectedId, live]);

  const flyToSatellite = useCallback(
    (id: number) => {
      if (map !== null && live !== null && live.id === id) {
        flyTo(map, live);
      } else {
        pendingFlyRef.current = id;
      }
    },
    [map, live],
  );

  return {state, followed, flyToSatellite};
}
