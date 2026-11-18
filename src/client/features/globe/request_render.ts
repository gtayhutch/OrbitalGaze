/**
 * @fileoverview Asks the globe for a new frame, safely.
 *
 * Layer: client feature (browser only).
 *
 * The viewer only redraws when asked (`requestRenderMode`), so every change
 * made outside Cesium's own animation (new pins, a filter, a zoom button)
 * must request a frame. This helper does that and ignores a viewer that is
 * gone or already destroyed, which can happen during React cleanup.
 */
import type {Viewer} from 'cesium';

/**
 * Requests one new frame from `viewer`, if it still exists.
 *
 * @param viewer The globe's viewer, or `null`.
 * @example
 * billboards.add(...);
 * requestRender(viewer);
 */
export function requestRender(viewer: Viewer | null | undefined): void {
  if (viewer !== null && viewer !== undefined && !viewer.isDestroyed()) {
    viewer.scene.requestRender();
  }
}
