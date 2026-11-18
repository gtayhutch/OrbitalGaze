/**
 * @fileoverview React component that shows the interactive 3D globe.
 *
 * Layer: client feature (browser only). Rendered by the app shell.
 *
 * CesiumJS manages its own canvas, render loop, and web workers outside
 * React. This component bridges the two:
 * - A ref callback creates the viewer and the camera pin layer when the
 *   container element appears, and destroys both when it goes away.
 * - Effects push React props (cameras, visible categories, the selected
 *   camera, the point to fly to) into the pin layer whenever they change.
 * - A share link's view is applied once, when the viewer is created, and
 *   each time the camera stops moving its new view is reported back (for
 *   the URL), so a link or a reload opens the same view.
 * - Cesium's loading progress becomes React state for the loading and error
 *   overlays.
 *
 * Credits: Cesium writes the imagery credits into a strip this component
 * owns (instead of the bottom of its canvas), next to any extra credits the
 * app passes in, so the whole strip stays visible above the phone bottom
 * sheet.
 *
 * The component's status is also exposed as `data-globe-status` on its root
 * element ("loading", "ready", or "error"), which the end-to-end tests wait on.
 */
import 'cesium/Build/Cesium/Widgets/widgets.css';

import {Cartesian3, Math as CesiumMath, type Viewer} from 'cesium';
import {useCallback, useEffect, useRef, useState} from 'react';

import {parseClientConfig} from '@/client/lib/config';
import {cn} from '@/client/lib/utils';
import type {CameraCategory, CameraIndexEntry} from '@/shared/cameras';

import {createCameraLayer, type CameraLayer} from './camera_layer';
import type {CameraView} from './camera_view';
import {createGlobeViewer} from './create_globe_viewer';
import {GlobeControls} from './globe_controls';

/** Where the globe is in its lifecycle. */
export type GlobeStatus = 'loading' | 'ready' | 'error';

/**
 * A place the globe should fly to. Each new object triggers one flight, so
 * callers create a new one only when the target changes (for example with
 * `useMemo` keyed on the selected camera).
 */
export interface GlobeFocus {
  readonly lat: number;
  readonly lng: number;
}

/** Props for {@link GlobeView}. */
export interface GlobeViewProps {
  /** Pins to draw. */
  cameras: readonly CameraIndexEntry[];
  /** Categories whose pins are shown. */
  visibleCategories: ReadonlySet<CameraCategory>;
  /** Where to fly, for example the selected camera; `null` stays put. */
  focus: GlobeFocus | null;
  /** The selected camera, whose pin is highlighted and never clustered. */
  selectedCameraId?: string | null;
  /**
   * Where the camera starts, for example from a share link. Read once,
   * when the globe is created; `null` starts at Cesium's default view.
   */
  initialView?: CameraView | null;
  /** Called with the camera's view each time it stops moving. */
  onViewChange?: (view: CameraView) => void;
  /** Called with a camera's ID when its pin is clicked. */
  onSelectCamera: (cameraId: string) => void;
  /**
   * True while the detail panel is open: it covers the right side on wide
   * screens (the controls move left) and the bottom on phones (the credits
   * move above it).
   */
  isDetailOpen: boolean;
  /**
   * The data credits shown above the imagery credits (the layers' credit
   * bar). It brings its own background, and may render nothing.
   */
  credits?: React.ReactNode;
  /** Extra classes for the root element, usually for positioning. */
  className?: string;
}

/**
 * The full interactive globe with camera pins, controls, and loading and
 * error overlays.
 *
 * @example
 * <GlobeView
 *   className="absolute inset-0"
 *   cameras={index.cameras}
 *   visibleCategories={filter.visible}
 *   focus={null}
 *   onSelectCamera={setCameraId}
 *   isDetailOpen={false}
 * />
 */
export function GlobeView({
  cameras,
  visibleCategories,
  focus,
  selectedCameraId = null,
  initialView = null,
  onViewChange,
  onSelectCamera,
  isDetailOpen,
  credits,
  className,
}: GlobeViewProps): React.JSX.Element {
  const [status, setStatus] = useState<GlobeStatus>('loading');
  const viewerRef = useRef<Viewer | null>(null);
  // Cesium writes its imagery credits into this element. It is rendered
  // before the globe container, so it exists when the viewer is created.
  const imageryCreditsRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<CameraLayer | null>(null);
  // The latest click handler, read when a pin is clicked, so the layer never
  // calls a stale one.
  const onSelectRef = useRef(onSelectCamera);
  useEffect(() => {
    onSelectRef.current = onSelectCamera;
  }, [onSelectCamera]);
  // Same for the view callback. The initial view is only read at creation,
  // so it lives in a ref too, which keeps `attachGlobe` stable.
  const onViewChangeRef = useRef(onViewChange);
  useEffect(() => {
    onViewChangeRef.current = onViewChange;
  }, [onViewChange]);
  const initialViewRef = useRef(initialView);

  // Stable across renders, so React attaches the globe once per element.
  const attachGlobe = useCallback((container: HTMLDivElement) => {
    // Step 1: create the viewer. Failure here almost always means WebGL is
    // unavailable, which the error overlay explains to the user.
    let viewer: Viewer;
    try {
      viewer = createGlobeViewer(container, {
        ...parseClientConfig(),
        creditContainer: imageryCreditsRef.current ?? undefined,
      });
    } catch (error) {
      console.error('Could not start the globe.', error);
      setStatus('error');
      return undefined;
    }
    setStatus('loading');
    viewerRef.current = viewer;

    // Start where a share link (or the last visit's URL) says, then report
    // every settled view so the URL can follow it.
    const startView = initialViewRef.current;
    if (startView !== null) {
      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(
          startView.lng,
          startView.lat,
          startView.height,
        ),
        orientation: {
          heading: CesiumMath.toRadians(startView.heading),
          pitch: CesiumMath.toRadians(startView.pitch),
          roll: 0,
        },
      });
    }
    viewer.camera.moveEnd.addEventListener(() => {
      const {longitude, latitude, height} = viewer.camera.positionCartographic;
      onViewChangeRef.current?.({
        lng: CesiumMath.toDegrees(longitude),
        lat: CesiumMath.toDegrees(latitude),
        height,
        heading: CesiumMath.toDegrees(viewer.camera.heading),
        pitch: CesiumMath.toDegrees(viewer.camera.pitch),
      });
    });
    layerRef.current = createCameraLayer(viewer, cameraId => {
      onSelectRef.current(cameraId);
    });

    // Step 2: report "ready" after the first frame in which every visible
    // tile has loaded, then stop listening. Each finished tile requests a new
    // frame, so this check runs again until loading completes.
    const removeReadyListener = viewer.scene.postRender.addEventListener(() => {
      if (viewer.scene.globe.tilesLoaded) {
        setStatus('ready');
        removeReadyListener();
      }
    });

    // Step 3: when the element goes away, release the pins, the WebGL
    // context, web workers, and listeners.
    return () => {
      removeReadyListener();
      layerRef.current?.destroy();
      layerRef.current = null;
      viewerRef.current = null;
      if (!viewer.isDestroyed()) {
        viewer.destroy();
      }
    };
  }, []);

  // Push props into the pin layer. Effects run after the ref callback, so the
  // layer exists by then (unless the globe failed to start).
  useEffect(() => {
    layerRef.current?.setVisibleCategories(visibleCategories);
  }, [visibleCategories]);
  useEffect(() => {
    layerRef.current?.setCameras(cameras);
  }, [cameras]);
  useEffect(() => {
    layerRef.current?.setSelected(selectedCameraId);
  }, [selectedCameraId]);
  // Callers keep `focus` referentially stable until the target changes (see
  // the `GlobeFocus` docs), so this flies once per new target.
  useEffect(() => {
    if (focus !== null) {
      layerRef.current?.flyTo(focus);
    }
  }, [focus]);

  return (
    <div className={cn('bg-background', className)} data-globe-status={status}>
      {/* Credit strip: the imagery providers' credits (required by their
          terms) and any extra credits, always visible. On phones it moves
          above the bottom sheet, whose height is BOTTOM_SHEET_HEIGHT_CLASS
          in the cameras feature. */}
      <div
        className={cn(
          'absolute bottom-1 left-2 z-10 flex max-w-[calc(100%-1rem)] flex-col items-start gap-1 text-[11px] leading-tight text-foreground/90',
          isDetailOpen && 'max-md:bottom-[calc(60dvh+0.25rem)]',
        )}
      >
        {credits}
        <div ref={imageryCreditsRef} className="og-imagery-credits" />
      </div>
      <div
        ref={attachGlobe}
        className="h-full w-full"
        role="application"
        aria-label="Interactive 3D globe. Drag to rotate; scroll or pinch to zoom. Use search or the layer panel for a list of cameras."
      />
      {status === 'ready' && (
        <GlobeControls
          viewerRef={viewerRef}
          className={cn(
            'absolute top-24 right-4 md:top-1/2 md:-translate-y-1/2',
            isDetailOpen && 'md:right-[26rem]',
          )}
        />
      )}
      {status === 'loading' && (
        <p
          role="status"
          className="pointer-events-none absolute inset-x-0 bottom-24 text-center text-sm text-muted-foreground"
        >
          Loading the globe…
        </p>
      )}
      {status === 'error' && (
        <div
          role="alert"
          className="absolute inset-0 grid place-items-center p-6"
        >
          <div className="max-w-md rounded-xl border border-panel-border bg-panel p-6 text-center backdrop-blur-md">
            <h2 className="text-lg font-semibold">
              The globe couldn&apos;t start
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              OrbitalGaze needs WebGL to draw the globe. Try turning on hardware
              acceleration in your browser settings, or use a recent version of
              Chrome, Edge, Firefox, or Safari.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
