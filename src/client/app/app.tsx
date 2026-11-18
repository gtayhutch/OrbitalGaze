/**
 * @fileoverview The app shell: the globe with the interface layered on top.
 *
 * Layer: client app shell (browser only). Rendered by `main.tsx`.
 *
 * The globe fills the whole window. Interface panels float above it in
 * absolutely positioned layers:
 * - top left: the top bar (brand, environment badge), with the layer panel
 *   below it;
 * - right (bottom sheet on phones): the selected camera's details.
 *
 * The selected camera lives in the URL (`?camera=<id>`), so a link opens the
 * same camera and Back closes it. Selecting a camera, from a pin or a link,
 * loads its details and flies the globe there.
 *
 * The globe is loaded lazily: CesiumJS is several megabytes, so the shell
 * (brand, panels) appears first and the globe streams in behind it.
 * Everything is wrapped in an error boundary so a failure shows a recovery
 * screen instead of a blank page.
 */
import {lazy, Suspense, useCallback, useMemo} from 'react';

import {
  CameraDetailPanel,
  LayerPanel,
  useCameraDetail,
  useCameraIndex,
  useCategoryFilter,
} from '@/client/features/cameras';
import {useUrlParam} from '@/client/lib/use_url_param';
import {CameraIdSchema, type CameraIndexEntry} from '@/shared/cameras';

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

  // The selection comes from the URL; anything that isn't a valid camera ID
  // (a mistyped or tampered link) is ignored.
  const [rawCameraId, setCameraId] = useUrlParam(CAMERA_URL_PARAM);
  const selectedCameraId = CameraIdSchema.safeParse(rawCameraId).success
    ? rawCameraId
    : null;
  const detail = useCameraDetail(selectedCameraId);

  const closeDetail = useCallback(() => {
    setCameraId(null);
  }, [setCameraId]);

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
            visibleCategories={filter.visible}
            focus={focus}
            onSelectCamera={setCameraId}
            isDetailOpen={detail.status !== 'idle'}
          />
        </Suspense>
        <TopBar environment={environment} />
        <LayerPanel
          index={index}
          filter={filter}
          className="absolute top-24 left-4"
        />
        <CameraDetailPanel detail={detail} onClose={closeDetail} />
      </div>
    </AppErrorBoundary>
  );
}
