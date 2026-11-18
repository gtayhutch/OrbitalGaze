/**
 * @fileoverview Sharp frames when the globe is still, fast frames while it moves.
 *
 * Layer: client feature (browser only). Used by `create_globe_viewer.ts`.
 *
 * The globe only redraws when something changes, so a still view can afford
 * a high-quality frame:
 * - full-resolution pixels on high-density screens (up to 2× CSS pixels);
 * - 4× multisample anti-aliasing (MSAA).
 * While the camera moves, every frame counts, so it switches to CSS-pixel
 * resolution and cheap FXAA smoothing instead. It switches back as soon as
 * the movement ends.
 *
 * {@link renderSettingsFor} is pure and unit-tested. {@link attachRenderQuality}
 * applies it to a viewer and listens for camera movement.
 */
import type {Viewer} from 'cesium';

import {requestRender} from './request_render';

/** Upper limit for the still-frame resolution, in device pixels per CSS pixel. */
const MAX_STILL_PIXEL_RATIO = 2;

/** MSAA samples for still frames; 1 means off. */
const STILL_MSAA_SAMPLES = 4;

/** How the globe should be drawn. */
export interface RenderSettings {
  /** Multisample anti-aliasing samples; 1 means off. */
  readonly msaaSamples: number;
  /** Whether the cheap FXAA smoothing pass runs. */
  readonly fxaa: boolean;
  /** Pixels drawn per CSS pixel (Cesium's `resolutionScale`). */
  readonly resolutionScale: number;
}

/**
 * Picks render settings for a still or moving camera.
 *
 * @param moving Whether the camera is moving.
 * @param devicePixelRatio The screen's device pixels per CSS pixel.
 * @returns The settings to apply.
 * @example
 * renderSettingsFor(false, 3); // {msaaSamples: 4, fxaa: false, resolutionScale: 2}
 * renderSettingsFor(true, 3); // {msaaSamples: 1, fxaa: true, resolutionScale: 1}
 */
export function renderSettingsFor(
  moving: boolean,
  devicePixelRatio: number,
): RenderSettings {
  if (moving) {
    return {msaaSamples: 1, fxaa: true, resolutionScale: 1};
  }
  const ratio =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 1
      ? devicePixelRatio
      : 1;
  return {
    msaaSamples: STILL_MSAA_SAMPLES,
    fxaa: false,
    resolutionScale: Math.min(ratio, MAX_STILL_PIXEL_RATIO),
  };
}

/** Applies settings to the viewer, skipping MSAA where the browser lacks it. */
function applySettings(viewer: Viewer, settings: RenderSettings): void {
  const {scene} = viewer;
  if (scene.msaaSupported) {
    scene.msaaSamples = settings.msaaSamples;
  }
  scene.postProcessStages.fxaa.enabled = settings.fxaa;
  viewer.resolutionScale = settings.resolutionScale;
  requestRender(viewer);
}

/**
 * Switches the viewer between still and moving render settings as the
 * camera starts and stops, starting with the still settings.
 *
 * @param viewer The globe's viewer.
 * @returns A function that stops listening. The listeners also go away with
 *     the viewer.
 * @example
 * const detach = attachRenderQuality(viewer);
 */
export function attachRenderQuality(viewer: Viewer): () => void {
  const pixelRatio = (): number => window.devicePixelRatio;
  applySettings(viewer, renderSettingsFor(false, pixelRatio()));
  const removeStart = viewer.camera.moveStart.addEventListener(() => {
    applySettings(viewer, renderSettingsFor(true, pixelRatio()));
  });
  const removeEnd = viewer.camera.moveEnd.addEventListener(() => {
    applySettings(viewer, renderSettingsFor(false, pixelRatio()));
  });
  return () => {
    removeStart();
    removeEnd();
  };
}
