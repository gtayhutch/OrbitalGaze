/**
 * @fileoverview Cesium renderer for earthquake epicentres. The app's
 * earthquake list offers keyboard access to the same events and details.
 */
import {Cartesian3, Color, PointPrimitiveCollection, type Viewer} from 'cesium';

import type {Earthquake} from '@/shared/earthquakes';

import {requestRender} from './request_render';

/** Age at which a marker changes from amber to purple. */
const RECENT_MS = 60 * 60_000;

/** Recent earthquakes are amber. */
const RECENT_COLOR = Color.fromCssColorString('#fbbf24');

/** Older earthquakes in the snapshot are violet. */
const OLDER_COLOR = Color.fromCssColorString('#a78bfa');

/** Smallest visible marker in CSS pixels. */
const MIN_POINT_SIZE = 6;

/** Largest marker in CSS pixels, even for very high magnitudes. */
const MAX_POINT_SIZE = 24;

/** Pixels added per magnitude unit. */
const PIXELS_PER_MAGNITUDE = 2;

/** The globe's handle to the batched earthquake renderer. */
export interface EarthquakeLayer {
  /** Updates all points after a refresh or selection change. */
  update(
    events: readonly Earthquake[],
    checkedAt: string | null,
    selected: string | null,
  ): void;
}

/** Attaches an epicentre point collection owned and disposed by the viewer. */
export function createEarthquakeLayer(viewer: Viewer): EarthquakeLayer {
  const points = viewer.scene.primitives.add(new PointPrimitiveCollection());
  return {
    update(events, checkedAt, selected) {
      points.removeAll();
      const asOf = checkedAt === null ? 0 : Date.parse(checkedAt);
      for (const event of events) {
        const magnitude = Math.max(0, event.magnitude ?? 0);
        points.add({
          position: Cartesian3.fromDegrees(event.lng, event.lat),
          color:
            asOf - Date.parse(event.occurredAt) < RECENT_MS
              ? RECENT_COLOR
              : OLDER_COLOR,
          pixelSize: Math.min(
            MAX_POINT_SIZE,
            MIN_POINT_SIZE + PIXELS_PER_MAGNITUDE * magnitude,
          ),
          outlineColor: event.id === selected ? Color.WHITE : Color.BLACK,
          outlineWidth: event.id === selected ? 3 : 1,
        });
      }
      requestRender(viewer);
    },
  };
}
