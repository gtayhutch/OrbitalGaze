/**
 * @fileoverview The app shell: the globe with the interface layered on top.
 *
 * Layer: client app shell (browser only). Rendered by `main.tsx`.
 *
 * The globe fills the whole window. Interface panels float above it in
 * absolutely positioned layers:
 * - top left: the top bar (brand, environment badge, search), with the
 *   layer panel below it (layers grouped by domain, each with a switch);
 * - right (bottom sheet on phones): the selected camera's details.
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
 * The globe is loaded lazily: CesiumJS is several megabytes, so the shell
 * (brand, panels) appears first and the globe streams in behind it.
 * Everything is wrapped in an error boundary so a failure shows a recovery
 * screen instead of a blank page.
 */
import {lazy, Suspense, useCallback, useMemo, useState} from 'react';

import {
  CameraDetailPanel,
  CameraLayerControls,
  useCameraDetail,
  useCameraIndex,
  useCategoryFilter,
} from '@/client/features/cameras';
import {CreditBar, LayerPanel, useActiveLayers} from '@/client/features/layers';
import type {CameraView} from '@/client/features/globe';
import {
  SearchDialog,
  SearchTrigger,
  useSearchShortcut,
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
import {useUrlParam} from '@/client/lib/use_url_param';
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

/** Shared empty list, so the globe doesn't redraw while the index loads. */
const NO_CAMERAS: readonly CameraIndexEntry[] = [];

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
      setCameraId(cameraId);
    },
    [setLayerActive, setCameraId],
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
  const focusLat = detail.status === 'ready' ? detail.camera.lat : null;
  const focusLng = detail.status === 'ready' ? detail.camera.lng : null;
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
            initialView={initialView}
            onViewChange={recordView}
            onSelectCamera={setCameraId}
            isDetailOpen={detail.status !== 'idle'}
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
          }}
          className="absolute top-24 left-4"
        />
        <CameraDetailPanel detail={detail} onClose={closeDetail} />
        <SearchDialog
          open={isSearchOpen}
          onOpenChange={setIsSearchOpen}
          onSelectCamera={selectSearchResult}
        />
      </div>
    </AppErrorBoundary>
  );
}
