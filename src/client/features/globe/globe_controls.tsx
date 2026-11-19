/**
 * @fileoverview Zoom and reset buttons for the globe.
 *
 * Layer: client feature (browser only). Rendered by `globe_view.tsx`.
 *
 * Mouse and touch users can zoom with the wheel or a pinch; these buttons
 * give keyboard and screen-reader users the same control, and a quick way
 * back to the whole-Earth view.
 */
import {LocateFixed, Minus, Plus} from 'lucide-react';
import type {Map as MapLibreMap} from 'maplibre-gl';
import type {RefObject} from 'react';

import {Button} from '@/client/components/ui/button';
import {prefersReducedMotion} from '@/client/lib/motion';
import {cn} from '@/client/lib/utils';

import {HOME_VIEW} from './create_map';

/** Duration of one zoom step, in milliseconds (0 with reduced motion). */
const ZOOM_STEP_MS = 300;

/** Duration of the flight back to the whole-Earth view, in milliseconds. */
const RESET_FLIGHT_MS = 1_500;

/** Props for {@link GlobeControls}. */
export interface GlobeControlsProps {
  /** The globe's map; buttons do nothing while it is absent. */
  mapRef: RefObject<MapLibreMap | null>;
  /** Extra classes for positioning. */
  className?: string;
}

/**
 * Vertical stack of zoom in, zoom out, and reset-view buttons.
 *
 * @example
 * <GlobeControls mapRef={mapRef} className="absolute right-4 top-1/2" />
 */
export function GlobeControls({
  mapRef,
  className,
}: GlobeControlsProps): React.JSX.Element {
  const duration = (milliseconds: number): number =>
    prefersReducedMotion() ? 0 : milliseconds;

  /** Zooms one level in or out around the centre of the view. */
  const zoom = (direction: 1 | -1): void => {
    const map = mapRef.current;
    if (map === null) {
      return;
    }
    if (direction === 1) {
      map.zoomIn({duration: duration(ZOOM_STEP_MS)});
    } else {
      map.zoomOut({duration: duration(ZOOM_STEP_MS)});
    }
  };

  /** Flies back to the starting whole-Earth view, north up. */
  const resetView = (): void => {
    mapRef.current?.flyTo({
      center: [HOME_VIEW.lng, HOME_VIEW.lat],
      zoom: HOME_VIEW.zoom,
      bearing: HOME_VIEW.bearing,
      pitch: HOME_VIEW.pitch,
      duration: duration(RESET_FLIGHT_MS),
      essential: true,
    });
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
