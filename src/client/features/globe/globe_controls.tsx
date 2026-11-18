/**
 * @fileoverview Zoom and reset buttons for the globe.
 *
 * Layer: client feature (browser only). Rendered by `globe_view.tsx`.
 *
 * Mouse and touch users can zoom with the wheel or a pinch; these buttons
 * give keyboard and screen-reader users the same control, and a quick way
 * back to the whole-Earth view.
 */
import type {Viewer} from 'cesium';
import {LocateFixed, Minus, Plus} from 'lucide-react';
import type {RefObject} from 'react';

import {Button} from '@/client/components/ui/button';
import {prefersReducedMotion} from '@/client/lib/motion';
import {cn} from '@/client/lib/utils';

/**
 * Fraction of the current height above ground that one zoom step moves.
 * Zooming by a fraction feels the same whether you're over a city or in
 * orbit.
 */
const ZOOM_STEP_FRACTION = 0.5;

/** Duration of the flight back to the whole-Earth view, in seconds. */
const RESET_FLIGHT_SECONDS = 1.5;

/** Props for {@link GlobeControls}. */
export interface GlobeControlsProps {
  /** The globe's viewer; buttons do nothing while it is absent. */
  viewerRef: RefObject<Viewer | null>;
  /** Extra classes for positioning. */
  className?: string;
}

/**
 * Vertical stack of zoom in, zoom out, and reset-view buttons.
 *
 * @example
 * <GlobeControls viewerRef={viewerRef} className="absolute right-4 top-1/2" />
 */
export function GlobeControls({
  viewerRef,
  className,
}: GlobeControlsProps): React.JSX.Element {
  /** Moves the camera toward (`direction` 1) or away from (-1) the ground. */
  const zoom = (direction: 1 | -1): void => {
    const viewer = viewerRef.current;
    if (viewer === null) {
      return;
    }
    const height = viewer.camera.positionCartographic.height;
    if (direction === 1) {
      viewer.camera.zoomIn(height * ZOOM_STEP_FRACTION);
    } else {
      viewer.camera.zoomOut(height * ZOOM_STEP_FRACTION);
    }
    viewer.scene.requestRender();
  };

  /** Flies back to the starting whole-Earth view. */
  const resetView = (): void => {
    viewerRef.current?.camera.flyHome(
      prefersReducedMotion() ? 0 : RESET_FLIGHT_SECONDS,
    );
  };

  return (
    <div
      role="group"
      aria-label="Globe view controls"
      className={cn(
        'flex flex-col gap-1 rounded-xl border border-panel-border bg-panel p-1 backdrop-blur-md',
        className,
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        aria-label="Zoom in"
        onClick={() => {
          zoom(1);
        }}
      >
        <Plus aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Zoom out"
        onClick={() => {
          zoom(-1);
        }}
      >
        <Minus aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Reset view to the whole Earth"
        onClick={resetView}
      >
        <LocateFixed aria-hidden="true" />
      </Button>
    </div>
  );
}
