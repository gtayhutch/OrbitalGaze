/**
 * @fileoverview React component that shows the interactive 3D globe.
 *
 * Layer: client feature (browser only). Rendered by the app shell.
 *
 * CesiumJS manages its own canvas, render loop, and web workers outside
 * React. This component bridges the two with a ref callback: React calls it
 * with the container element when the element appears, and calls the
 * function it returns when the element goes away. The viewer is created and
 * destroyed there, and Cesium's progress becomes React state for the loading
 * and error overlays.
 *
 * The component's status is also exposed as `data-globe-status` on its root
 * element ("loading", "ready", or "error"), which the end-to-end tests wait on.
 */
import 'cesium/Build/Cesium/Widgets/widgets.css';

import {useCallback, useState} from 'react';

import {parseClientConfig} from '@/client/lib/config';
import {cn} from '@/client/lib/utils';

import {createGlobeViewer} from './create_globe_viewer';

/** Where the globe is in its lifecycle. */
export type GlobeStatus = 'loading' | 'ready' | 'error';

/** Props for {@link GlobeView}. */
export interface GlobeViewProps {
  /** Extra classes for the root element, usually for positioning. */
  className?: string;
}

/**
 * The full interactive globe, with loading and error overlays.
 *
 * @example
 * <GlobeView className="absolute inset-0" />
 */
export function GlobeView({className}: GlobeViewProps): React.JSX.Element {
  const [status, setStatus] = useState<GlobeStatus>('loading');

  // Stable across renders, so React attaches the globe once per element.
  const attachGlobe = useCallback((container: HTMLDivElement) => {
    // Step 1: create the viewer. Failure here almost always means WebGL is
    // unavailable, which the error overlay explains to the user.
    let viewer: ReturnType<typeof createGlobeViewer>;
    try {
      viewer = createGlobeViewer(container, parseClientConfig());
    } catch (error) {
      console.error('Could not start the globe.', error);
      setStatus('error');
      return undefined;
    }
    setStatus('loading');

    // Step 2: report "ready" after the first frame in which every visible
    // tile has loaded, then stop listening. Each finished tile requests a new
    // frame, so this check runs again until loading completes.
    const removeReadyListener = viewer.scene.postRender.addEventListener(() => {
      if (viewer.scene.globe.tilesLoaded) {
        setStatus('ready');
        removeReadyListener();
      }
    });

    // Step 3: when the element goes away, release the WebGL context, web
    // workers, and listeners.
    return () => {
      removeReadyListener();
      if (!viewer.isDestroyed()) {
        viewer.destroy();
      }
    };
  }, []);

  return (
    <div className={cn('bg-background', className)} data-globe-status={status}>
      <div
        ref={attachGlobe}
        className="h-full w-full"
        role="application"
        aria-label="Interactive 3D globe. Drag to rotate; scroll or pinch to zoom."
      />
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
