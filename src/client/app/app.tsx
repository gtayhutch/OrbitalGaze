/**
 * @fileoverview The app shell: the globe with the interface layered on top.
 *
 * Layer: client app shell (browser only). Rendered by `main.tsx`.
 *
 * The globe fills the whole window. Interface panels float above it in
 * absolutely positioned layers:
 * - top left: the top bar (brand, environment badge, search), with the
 *   layer panel below it (layers grouped by domain, each with a switch);
 * - right (bottom sheet on phones): the selected camera's or satellite's
 *   details (one at a time).
 *
 * The selected camera lives in the URL (`?camera=<id>`), so a link opens the
 * same camera and Back closes it. Selecting a camera, from a pin or a link,
 * loads its details and flies the globe there.
 *
 * Search (button or Ctrl K / ⌘K) opens a dialog; choosing a result selects
 * that camera exactly like clicking its pin, and switches the webcam layer
 * on if it was off, so the chosen camera's pin is visible.
 *
 * The globe's view lives in the URL too (`?view=`), rewritten in place each
 * time the camera stops, so a reload or a copied address opens the same
 * view. "Share this view" copies that address plus the active layers
 * (`?layers=`); a visitor arriving with `?layers=` sees those layers for
 * the visit without their own saved choices changing.
 *
 * Which layers are on comes from the layer registry and the visitor's saved
 * choices. A layer that is off draws nothing, and its credit leaves the
 * credit bar.
 *
 * The followed satellite lives in the URL too (`?satellite=<NORAD number>`).
 * A link with it switches the satellites layer on. Selecting a satellite
 * closes any camera or earthquake, and the other way round. While the
 * satellites layer is on, search also matches satellite names and numbers.
 *
 * The globe is loaded lazily: MapLibre is over a megabyte, so the shell
 * (brand, panels) appears first and the globe streams in behind it.
 * Everything is wrapped in an error boundary so a failure shows a recovery
 * screen instead of a blank page.
 */
import type {Map as MapLibreMap} from 'maplibre-gl';
import {lazy, Suspense, useCallback, useEffect, useMemo, useState} from 'react';

import {
  CameraDetailPanel,
  CameraLayerControls,
  useCameraDetail,
  useCameraIndex,
  useCategoryFilter,
} from '@/client/features/cameras';
import {EarthquakeControls} from '@/client/features/earthquakes';
import {CreditBar, LayerPanel, useActiveLayers} from '@/client/features/layers';
import type {CameraView} from '@/client/features/globe';
import {
  SatelliteControls,
  SatelliteDetailPanel,
  SATELLITE_GROUP_STYLES,
  searchSatellites,
  useSatelliteGroups,
  useSatellites,
} from '@/client/features/satellites';
import {
  SearchDialog,
  SearchTrigger,
  useSearchShortcut,
  type ExtraSearchGroup,
} from '@/client/features/search';
import {
  buildShareUrl,
  decodeLayers,
  decodeView,
  encodeView,
  LAYERS_URL_PARAM,
  ShareButton,
  VIEW_URL_PARAM,
} from '@/client/features/share';
import {useLayerSnapshot} from '@/client/lib/use_layer_snapshot';
import {
  EARTHQUAKE_LAYER_ID,
  EARTHQUAKE_REFRESH_MINUTES,
  EarthquakeSchema,
  type Earthquake,
} from '@/shared/earthquakes';
import {useUrlParam} from '@/client/lib/use_url_param';
import {SATELLITE_LAYER_ID} from '@/shared/satellites';
import {
  CameraIdSchema,
  type CameraCategory,
  type CameraIndexEntry,
} from '@/shared/cameras';

import {AppErrorBoundary} from './app_error_boundary';
import {TopBar} from './top_bar';
import {useAppEnvironment} from './use_app_environment';

/** The globe component, fetched as a separate bundle on first render. */
const GlobeView = lazy(async () => {
  const globeFeature = await import('@/client/features/globe');
  return {default: globeFeature.GlobeView};
});

/** URL query parameter holding the selected camera's ID. */
export const CAMERA_URL_PARAM = 'camera';

/** URL query parameter holding the followed satellite's NORAD number. */
export const SATELLITE_URL_PARAM = 'satellite';

/** Most satellites listed in search. */
const MAX_SATELLITE_RESULTS = 8;

/** Reads a NORAD number from the URL; anything else is ignored. */
function parseSatelliteId(raw: string | null): number | null {
  return raw !== null && /^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : null;
}

/** Shared empty list, so the globe doesn't redraw while the index loads. */
const NO_CAMERAS: readonly CameraIndexEntry[] = [];

/** Stable empty list while the earthquake layer is off or loading. */
const NO_EARTHQUAKES: readonly Earthquake[] = [];

/** Shared empty set: every webcam pin hidden while the layer is off. */
const NO_CATEGORIES: ReadonlySet<CameraCategory> = new Set();

/**
 * The root component of the browser app.
 *
 * @example
 * createRoot(element).render(<App />);
 */
export function App(): React.JSX.Element {
  const environment = useAppEnvironment();
  const index = useCameraIndex();
  const filter = useCategoryFilter();
  // A share link's layers and view are read once, on the first render.
  const [linkLayers] = useState(() =>
    decodeLayers(
      new URLSearchParams(window.location.search).get(LAYERS_URL_PARAM),
    ),
  );
  const activeLayers = useActiveLayers(linkLayers);
  const {setLayerActive} = activeLayers;
  const showWebcams = activeLayers.active.has('webcams');

  // The selection comes from the URL; anything that isn't a valid camera ID
  // (a mistyped or tampered link) is ignored.
  const [rawCameraId, setCameraId] = useUrlParam(CAMERA_URL_PARAM);
  const selectedCameraId = CameraIdSchema.safeParse(rawCameraId).success
    ? rawCameraId
    : null;
  const detail = useCameraDetail(selectedCameraId);
  const showEarthquakes = activeLayers.active.has(EARTHQUAKE_LAYER_ID);
  const earthquakeSnapshot = useLayerSnapshot(
    EARTHQUAKE_LAYER_ID,
    EarthquakeSchema,
    EARTHQUAKE_REFRESH_MINUTES * 60_000,
    showEarthquakes,
  );
  const [requestedQuake, setRequestedQuake] = useState<string | null>(null);
  const earthquakes =
    showEarthquakes && earthquakeSnapshot.status === 'ready'
      ? earthquakeSnapshot.items
      : NO_EARTHQUAKES;
  const selectedQuake =
    selectedCameraId === null
      ? (earthquakes.find(event => event.id === requestedQuake) ?? null)
      : null;

  // The followed satellite, from the URL. A link with one switches the
  // satellites layer on (once, on arrival).
  const [rawSatelliteId, setSatelliteParam] = useUrlParam(SATELLITE_URL_PARAM);
  const selectedSatelliteId = parseSatelliteId(rawSatelliteId);
  const [linkSatellite] = useState(selectedSatelliteId);
  useEffect(() => {
    if (linkSatellite !== null) {
      setLayerActive(SATELLITE_LAYER_ID, true);
    }
  }, [linkSatellite, setLayerActive]);
  const showSatellites = activeLayers.active.has(SATELLITE_LAYER_ID);
  const satelliteGroups = useSatelliteGroups();
  const [map, setMap] = useState<MapLibreMap | null>(null);

  /** Selects a camera and clears the current earthquake and satellite. */
  const selectCamera = useCallback(
    (id: string) => {
      setRequestedQuake(null);
      setSatelliteParam(null);
      setCameraId(id);
    },
    [setCameraId, setSatelliteParam],
  );

  /** Selects a quake from its accessible list and dismisses the others. */
  const selectQuake = useCallback(
    (id: string) => {
      setCameraId(null);
      setSatelliteParam(null);
      setRequestedQuake(id);
    },
    [setCameraId, setSatelliteParam],
  );

  /** Follows a satellite and dismisses any camera or earthquake. */
  const selectSatellite = useCallback(
    (id: number) => {
      setCameraId(null);
      setRequestedQuake(null);
      setSatelliteParam(String(id));
    },
    [setCameraId, setSatelliteParam],
  );
  const satellites = useSatellites({
    enabled: showSatellites,
    map,
    visibleGroups: satelliteGroups.visible,
    selectedId: selectedSatelliteId,
    onSelect: selectSatellite,
  });
  const {flyToSatellite} = satellites;
  const closeSatellite = useCallback(() => {
    setSatelliteParam(null);
  }, [setSatelliteParam]);
  const flyToFollowed = useCallback(() => {
    if (selectedSatelliteId !== null) {
      flyToSatellite(selectedSatelliteId);
    }
  }, [flyToSatellite, selectedSatelliteId]);

  // While the layer is on, search also finds satellites by name or number.
  const satelliteCatalog =
    satellites.state.status === 'ready' ? satellites.state.catalog : null;
  const satelliteSearch = useMemo((): ExtraSearchGroup | undefined => {
    if (satelliteCatalog === null) {
      return undefined;
    }
    return {
      heading: 'Satellites',
      search: query =>
        searchSatellites(query, satelliteCatalog, MAX_SATELLITE_RESULTS).map(
          position => {
            const id = satelliteCatalog.ids[position] ?? 0;
            const group = satelliteCatalog.groups[position] ?? 'other';
            const style = SATELLITE_GROUP_STYLES[group];
            return {
              key: String(id),
              label: satelliteCatalog.names[position] ?? String(id),
              detail: `${style.label} · No. ${String(id)}`,
              color: style.color,
              onSelect: () => {
                selectSatellite(id);
                flyToSatellite(id);
              },
            };
          },
        ),
    };
  }, [satelliteCatalog, selectSatellite, flyToSatellite]);

  // The view in the URL: read once as the starting view, then rewritten
  // (without new history entries) each time the camera stops.
  const [rawView, setViewParam] = useUrlParam(VIEW_URL_PARAM, {
    replace: true,
  });
  const [initialView] = useState(() => decodeView(rawView));
  const recordView = useCallback(
    (view: CameraView) => {
      setViewParam(encodeView(view));
    },
    [setViewParam],
  );
  const {active: activeLayerSet} = activeLayers;
  const getShareUrl = useCallback(
    () => buildShareUrl(window.location.href, activeLayerSet),
    [activeLayerSet],
  );

  const closeDetail = useCallback(() => {
    setCameraId(null);
  }, [setCameraId]);

  // A camera chosen in search should be visible on the globe, so its layer
  // comes on if it was off.
  const selectSearchResult = useCallback(
    (cameraId: string) => {
      setLayerActive('webcams', true);
      selectCamera(cameraId);
    },
    [setLayerActive, selectCamera],
  );

  // Search opens from the top bar button or Ctrl K / ⌘K.
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const openSearch = useCallback(() => {
    setIsSearchOpen(true);
  }, []);
  useSearchShortcut(openSearch);

  // Fly to the selected camera once its details (and coordinates) arrive.
  // The object only changes when the coordinates do, so the globe flies once
  // per selection.
  const focusLat =
    detail.status === 'ready'
      ? detail.camera.lat
      : (selectedQuake?.lat ?? null);
  const focusLng =
    detail.status === 'ready'
      ? detail.camera.lng
      : (selectedQuake?.lng ?? null);
  const focus = useMemo(
    () =>
      focusLat === null || focusLng === null
        ? null
        : {lat: focusLat, lng: focusLng},
    [focusLat, focusLng],
  );

  return (
    <AppErrorBoundary>
      <div className="relative h-dvh w-full overflow-hidden bg-background text-foreground">
        <Suspense
          fallback={
            <p
              role="status"
              className="absolute inset-x-0 bottom-24 text-center text-sm text-muted-foreground"
            >
              Loading the globe…
            </p>
          }
        >
          <GlobeView
            className="absolute inset-0"
            cameras={index.status === 'ready' ? index.cameras : NO_CAMERAS}
            visibleCategories={showWebcams ? filter.visible : NO_CATEGORIES}
            focus={focus}
            selectedCameraId={selectedCameraId}
            earthquakes={earthquakes}
            earthquakeCheckedAt={
              earthquakeSnapshot.status === 'ready'
                ? earthquakeSnapshot.checkedAt
                : null
            }
            selectedEarthquakeId={selectedQuake?.id ?? null}
            initialView={initialView}
            onViewChange={recordView}
            onSelectCamera={selectCamera}
            onMapReady={setMap}
            isDetailOpen={
              detail.status !== 'idle' || satellites.followed !== null
            }
            credits={<CreditBar active={activeLayers.active} />}
          />
        </Suspense>
        <TopBar
          environment={environment}
          search={<SearchTrigger onOpen={openSearch} />}
          share={<ShareButton getShareUrl={getShareUrl} />}
        />
        <LayerPanel
          activeLayers={activeLayers}
          layerControls={{
            webcams: <CameraLayerControls index={index} filter={filter} />,
            [EARTHQUAKE_LAYER_ID]: (
              <EarthquakeControls
                snapshot={earthquakeSnapshot}
                selected={selectedQuake}
                onSelect={selectQuake}
              />
            ),
            [SATELLITE_LAYER_ID]: (
              <SatelliteControls
                state={satellites.state}
                filter={satelliteGroups}
              />
            ),
          }}
          className="absolute top-24 left-4"
        />
        <CameraDetailPanel detail={detail} onClose={closeDetail} />
        {satelliteCatalog !== null && satellites.followed !== null && (
          <SatelliteDetailPanel
            catalog={satelliteCatalog}
            followed={satellites.followed}
            onFlyTo={flyToFollowed}
            onClose={closeSatellite}
          />
        )}
        <SearchDialog
          open={isSearchOpen}
          onOpenChange={setIsSearchOpen}
          onSelectCamera={selectSearchResult}
          extra={satelliteSearch}
        />
      </div>
    </AppErrorBoundary>
  );
}
