/**
 * @fileoverview React component that shows the interactive 3D globe.
 *
 * Layer: client feature (browser only). Rendered by the app shell.
 *
 * MapLibre manages its own canvas, render loop, and web workers outside
 * React. This component bridges the two:
 * - A ref callback creates the map and the camera and earthquake layers
 *   when the container element appears, and removes them when it goes away.
 * - Effects push React props (cameras, visible categories, the selected
 *   camera, earthquakes, the point to fly to) into the layers whenever they
 *   change.
 * - A share link's view is applied once, when the map is created, and each
 *   time the camera stops moving its new view is reported back (for the
 *   URL), so a link or a reload opens the same view.
 * - The basemap (land, roads, labels) is added once the Worker describes
 *   it. Without one (a fresh local checkout), the globe still works, plain.
 *
 * Credits: the basemap's credit (OpenStreetMap and Protomaps) sits in a strip
 * this component owns, next to any extra credits the app passes in, so the
 * whole strip stays visible above the phone bottom sheet.
 *
 * The component's status is also exposed as `data-globe-status` on its root
 * element ("loading", "ready", or "error"), which the end-to-end tests wait on.
 */
import type {Map as MapLibreMap} from 'maplibre-gl';
import {useCallback, useEffect, useRef, useState} from 'react';

import {reportBrowserError} from '@/client/lib/error_reporting';
import {cn} from '@/client/lib/utils';
import type {CameraCategory, CameraIndexEntry} from '@/shared/cameras';
import type {Earthquake} from '@/shared/earthquakes';

import {
  applyMapStyle,
  BASEMAP_SOURCE_ID,
  basemapLayers,
  basemapSourceSpec,
  fetchBasemapSource,
  SPACE_COLOUR,
  type BasemapSource,
  type GlobeMapStyle,
} from './basemap_style';
import {createCameraLayer, type CameraLayer} from './camera_layer';
import type {CameraView} from './camera_view';
import {createGlobeMap} from './create_map';
import {createEarthquakeLayer, type EarthquakeLayer} from './earthquake_layer';
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

/** A stable empty set of earthquake points for callers without the layer. */
const NO_EARTHQUAKES: readonly Earthquake[] = [];

/** Props for {@link GlobeView}. */
export interface GlobeViewProps {
  /** Pins to draw. */
  cameras: readonly CameraIndexEntry[];
  /** Earthquake points and their snapshot freshness, when the layer is on. */
  earthquakes?: readonly Earthquake[];
  earthquakeCheckedAt?: string | null;
  /** Highlights the earthquake selected from the layer panel. */
  selectedEarthquakeId?: string | null;
  /** Categories whose pins are shown. */
  visibleCategories: ReadonlySet<CameraCategory>;
  /** Where to fly, for example the selected camera; `null` stays put. */
  focus: GlobeFocus | null;
  /** The selected camera, whose pin is highlighted and never clustered. */
  selectedCameraId?: string | null;
  /**
   * Where the camera starts, for example from a share link. Read once,
   * when the globe is created; `null` starts on the whole Earth.
   */
  initialView?: CameraView | null;
  /** Called with the camera's view each time it stops moving. */
  onViewChange?: (view: CameraView) => void;
  /** Called with a camera's ID when its pin is clicked. */
  onSelectCamera: (cameraId: string) => void;
  /** The dark map (default) or satellite imagery. */
  mapStyle?: GlobeMapStyle;
  /**
   * Called with the map once it is ready (style loaded, basemap settled),
   * and with `null` when it goes away. Other features use it to add their
   * own drawing, such as the satellites overlay, without the globe
   * importing them.
   */
  onMapReady?: (map: MapLibreMap | null) => void;
  /**
   * True while the detail panel is open: it covers the right side on wide
   * screens (the controls move left) and the bottom on phones (the credits
   * move above it).
   */
  isDetailOpen: boolean;
  /**
   * The data credits shown above the basemap credit (the layers' credit
   * bar). It brings its own background, and may render nothing.
   */
  credits?: React.ReactNode;
  /** Extra classes for the root element, usually for positioning. */
  className?: string;
}

/**
 * Adds the basemap's source and layers beneath the app's own layers.
 *
 * @param map A map whose style has loaded.
 * @param source The Worker's description of the basemap tiles.
 */
function addBasemap(map: MapLibreMap, source: BasemapSource): void {
  map.addSource(BASEMAP_SOURCE_ID, basemapSourceSpec(source));
  // At this point the style holds the background, then only our layers
  // (earthquakes, cameras), so the basemap goes right above the background.
  const firstOverlay = map.getStyle().layers[1]?.id;
  for (const layer of basemapLayers()) {
    map.addLayer(layer, firstOverlay);
  }
}

/** Resolves once the map's style has loaded. */
function styleLoaded(map: MapLibreMap): Promise<void> {
  return new Promise(resolve => {
    if (map.isStyleLoaded() === true) {
      resolve();
    } else {
      map.once('load', () => {
        resolve();
      });
    }
  });
}

/** The camera's current view, in share-link terms. */
function currentView(map: MapLibreMap): CameraView {
  // After spinning the globe the longitude can pass ±180; wrap it back.
  const center = map.getCenter().wrap();
  return {
    lng: center.lng,
    lat: center.lat,
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
}

/**
 * The full interactive globe with camera pins, earthquakes, controls, and
 * loading and error overlays.
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
  earthquakes = NO_EARTHQUAKES,
  earthquakeCheckedAt = null,
  selectedEarthquakeId = null,
  visibleCategories,
  focus,
  selectedCameraId = null,
  initialView = null,
  onViewChange,
  onSelectCamera,
  mapStyle = 'dark',
  onMapReady,
  isDetailOpen,
  credits,
  className,
}: GlobeViewProps): React.JSX.Element {
  const [status, setStatus] = useState<GlobeStatus>('loading');
  const [hasBasemap, setHasBasemap] = useState(false);
  const mapRef = useRef<MapLibreMap | null>(null);
  const layerRef = useRef<CameraLayer | null>(null);
  const earthquakeLayerRef = useRef<EarthquakeLayer | null>(null);
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
  const onMapReadyRef = useRef(onMapReady);
  useEffect(() => {
    onMapReadyRef.current = onMapReady;
  }, [onMapReady]);

  // Stable across renders, so React attaches the globe once per element.
  const attachGlobe = useCallback((container: HTMLDivElement) => {
    // Step 1: create the map. Failure here almost always means WebGL is
    // unavailable, which the error overlay explains to the user.
    let map: MapLibreMap;
    try {
      map = createGlobeMap(container, initialViewRef.current);
    } catch (error) {
      console.error('Could not start the globe.', error);
      reportBrowserError('browser.globe-start', error);
      setStatus('error');
      return undefined;
    }
    setStatus('loading');
    mapRef.current = map;
    const teardown = new AbortController();

    // Step 2: our layers, and the view reports for the URL.
    layerRef.current = createCameraLayer(map, cameraId => {
      onSelectRef.current(cameraId);
    });
    earthquakeLayerRef.current = createEarthquakeLayer(map);
    map.on('moveend', () => {
      onViewChangeRef.current?.(currentView(map));
    });

    // Step 3: the basemap. Its description loads while the style does; a
    // site without a basemap (404) or a failed request leaves the globe
    // plain but working.
    const basemap = fetchBasemapSource(
      window.location.origin,
      teardown.signal,
    ).catch((error: unknown) => {
      if (!teardown.signal.aborted) {
        console.error('Could not load the basemap.', error);
        reportBrowserError('browser.globe-start', error);
      }
      return null;
    });
    void Promise.all([styleLoaded(map), basemap]).then(([, source]) => {
      if (teardown.signal.aborted) {
        return;
      }
      if (source !== null) {
        addBasemap(map, source);
        setHasBasemap(true);
      }
      // Step 4: "ready" once the first view has fully drawn, tiles included.
      // The repaint guarantees one more frame, and so one more `idle`.
      map.once('idle', () => {
        setStatus('ready');
      });
      onMapReadyRef.current?.(map);
      map.triggerRepaint();
    });

    // Step 5: when the element goes away, release the layers, the WebGL
    // context, web workers, and listeners.
    return () => {
      teardown.abort();
      onMapReadyRef.current?.(null);
      layerRef.current?.destroy();
      earthquakeLayerRef.current?.destroy();
      layerRef.current = null;
      earthquakeLayerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  // Push props into the layers. Effects run after the ref callback, so the
  // layers exist by then (unless the globe failed to start); they draw as
  // soon as the style has loaded.
  useEffect(() => {
    layerRef.current?.setVisibleCategories(visibleCategories);
  }, [visibleCategories]);
  useEffect(() => {
    layerRef.current?.setCameras(cameras);
  }, [cameras]);
  useEffect(() => {
    layerRef.current?.setSelected(selectedCameraId);
  }, [selectedCameraId]);
  useEffect(() => {
    earthquakeLayerRef.current?.update(
      earthquakes,
      earthquakeCheckedAt,
      selectedEarthquakeId,
    );
  }, [earthquakes, earthquakeCheckedAt, selectedEarthquakeId]);
  // The map style, once the map and its basemap are ready.
  useEffect(() => {
    const map = mapRef.current;
    if (map !== null && status === 'ready') {
      applyMapStyle(map, mapStyle, window.location.origin);
    }
  }, [mapStyle, status]);
  // Callers keep `focus` referentially stable until the target changes (see
  // the `GlobeFocus` docs), so this flies once per new target.
  useEffect(() => {
    if (focus !== null) {
      layerRef.current?.flyTo(focus);
    }
  }, [focus]);

  return (
    <div
      className={className}
      data-globe-status={status}
      // Space around the globe: a faint glow behind the atmosphere.
      style={{
        background: `radial-gradient(ellipse at center, #0b1526 0%, ${SPACE_COLOUR} 70%)`,
      }}
    >
      {/* Credit strip: the data credits and the basemap's credit (required
          by OpenStreetMap's licence), always visible. On phones it moves
          above the bottom sheet, whose height is BOTTOM_SHEET_HEIGHT_CLASS
          in the cameras feature. */}
      <div
        className={cn(
          'absolute bottom-1 left-2 z-10 flex max-w-[calc(100%-1rem)] flex-col items-start gap-1 text-[11px] leading-tight text-foreground/90',
          isDetailOpen && 'max-md:bottom-[calc(60dvh+0.25rem)]',
        )}
      >
        {credits}
        {mapStyle === 'satellite' && status === 'ready' && (
          <p className="rounded bg-background/70 px-1.5 py-0.5 backdrop-blur-sm">
            Imagery:{' '}
            <a
              href="https://nasa-gibs.github.io/gibs-api-docs/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              NASA GIBS
            </a>{' '}
            (Blue Marble)
          </p>
        )}
        {hasBasemap && (
          <p className="rounded bg-background/70 px-1.5 py-0.5 backdrop-blur-sm">
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              © OpenStreetMap contributors
            </a>
            {' · '}
            <a
              href="https://protomaps.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Protomaps
            </a>
          </p>
        )}
      </div>
      <div
        ref={attachGlobe}
        className="h-full w-full"
        role="application"
        aria-label="Interactive 3D globe. Drag to rotate; scroll or pinch to zoom; arrow keys pan when focused. Use search for cameras, or the layer panel for earthquake details."
      />
      {status === 'ready' && (
        <GlobeControls
          mapRef={mapRef}
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
