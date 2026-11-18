/**
 * @fileoverview Draws camera pins on the globe, clusters them, and handles clicks.
 *
 * Layer: client feature (browser only). Created and driven by `globe_view.tsx`.
 *
 * Pins are billboards in one `BillboardCollection`, which Cesium draws in a
 * single batch. That is much lighter than one entity per camera, and it
 * scales to the many point layers to come.
 *
 * Clustering is our own screen-space clustering (`grid_cluster.ts`):
 * - each camera is projected to the screen, and pins within
 *   `CLUSTER_PIXEL_RANGE` of each other merge. That is what "would overlap"
 *   means, wherever the camera is on the globe, including near its edge
 *   where distances look squashed;
 * - cameras on the far side of the Earth, and every camera once the view is
 *   close to the ground, stay single;
 * - pins are rebuilt when the camera stops moving and when the cameras,
 *   filter or selection change, never on every frame;
 * - the selected camera always keeps its own pin, drawn larger and on top.
 *
 * Clicking a single pin selects that camera; clicking a numbered cluster
 * zooms to the area its cameras cover.
 *
 * Pin images are drawn once per category (and once per cluster count) with
 * Cesium's `PinBuilder` and cached. The collection stores each distinct
 * image once, so thousands of pins share a handful of textures.
 */
import {
  BillboardCollection,
  Cartesian2,
  Cartesian3,
  Color,
  Ellipsoid,
  EllipsoidalOccluder,
  PinBuilder,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  type Viewer,
} from 'cesium';

import {CATEGORY_STYLES} from '@/client/features/cameras';
import {prefersReducedMotion} from '@/client/lib/motion';
import {
  CAMERA_CATEGORIES,
  type CameraCategory,
  type CameraIndexEntry,
} from '@/shared/cameras';

import {
  clusterPoints,
  type PointCluster,
  type ScreenPosition,
} from './grid_cluster';
import {requestRender} from './request_render';

/** Pin height for a single camera, in screen pixels. */
const CAMERA_PIN_SIZE_PX = 36;

/** Pin height for a cluster, in screen pixels. */
const CLUSTER_PIN_SIZE_PX = 48;

/** Color of cluster pins (the app's teal accent, darkened for contrast with white digits). */
const CLUSTER_PIN_COLOR = '#0f766e';

/** Pins closer than this many CSS pixels on screen merge into a cluster. */
const CLUSTER_PIXEL_RANGE = 48;

/**
 * Below this camera height, in metres, every pin shows on its own: at city
 * scale, a cluster would hide cameras the visitor is looking for.
 */
const NO_CLUSTER_BELOW_METRES = 5_000;

/** Clusters larger than this show "999+" instead of the exact count. */
const MAX_CLUSTER_LABEL = 999;

/** How much larger the selected camera's pin is drawn. */
const SELECTED_PIN_SCALE = 1.4;

/**
 * Pulls the selected pin towards the viewer, in metres, so it draws on top
 * of any pin it overlaps.
 */
const SELECTED_PIN_EYE_OFFSET = new Cartesian3(0, 0, -50);

/**
 * Within this distance of the camera, in metres, pins skip the depth test so
 * they never clip into the ground at street level. It stays well inside the
 * horizon at the heights where it applies, so pins on the far side of the
 * Earth stay hidden.
 */
const DISABLE_DEPTH_TEST_WITHIN_METRES = 100_000;

/**
 * Height above the ground, in metres, when flying to a camera: about a city's
 * width in view.
 */
const FLY_TO_HEIGHT_METRES = 40_000;

/** Duration of a camera flight, in seconds (0 with reduced motion). */
const FLY_DURATION_SECONDS = 2;

/** Extra margin around a cluster's cameras when zooming to them, in degrees. */
const CLUSTER_ZOOM_MARGIN_DEGREES = 0.05;

/** What a click on a billboard refers to; stored as the billboard's `id`. */
type PinTarget =
  | {readonly kind: 'camera'; readonly cameraId: string}
  | {readonly kind: 'cluster'; readonly cluster: PointCluster};

/** What the globe view can do with the camera pins. */
export interface CameraLayer {
  /** Replaces all pins. */
  setCameras(cameras: readonly CameraIndexEntry[]): void;
  /** Shows only pins in these categories. */
  setVisibleCategories(visible: ReadonlySet<CameraCategory>): void;
  /** Highlights one camera's pin and keeps it out of clusters; `null` clears. */
  setSelected(cameraId: string | null): void;
  /** Flies the view to a point above the given location. */
  flyTo(location: {readonly lat: number; readonly lng: number}): void;
  /** Removes the pins and click handling. Call before destroying the viewer. */
  destroy(): void;
}

/** Narrows a picked object's `id` to one of our pin targets. */
function asPinTarget(value: unknown): PinTarget | null {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    return null;
  }
  // Safe: only this layer creates billboards with a `kind`.
  return value as PinTarget;
}

/** The area covered by a cluster's cameras, with a small margin. */
function clusterRectangle(
  ids: readonly string[],
  cameraById: ReadonlyMap<string, CameraIndexEntry>,
): Rectangle {
  let west = 180;
  let south = 90;
  let east = -180;
  let north = -90;
  for (const id of ids) {
    const camera = cameraById.get(id);
    if (camera !== undefined) {
      west = Math.min(west, camera.lng);
      east = Math.max(east, camera.lng);
      south = Math.min(south, camera.lat);
      north = Math.max(north, camera.lat);
    }
  }
  const margin = CLUSTER_ZOOM_MARGIN_DEGREES;
  return Rectangle.fromDegrees(
    Math.max(west - margin, -180),
    Math.max(south - margin, -90),
    Math.min(east + margin, 180),
    Math.min(north + margin, 90),
  );
}

/**
 * Adds the camera layer to `viewer`.
 *
 * @param viewer The globe's viewer; it must outlive the layer.
 * @param onSelect Called with a camera's ID when its pin is clicked.
 * @returns The layer's controls.
 * @example
 * const layer = createCameraLayer(viewer, id => setSelectedId(id));
 * layer.setCameras(index.cameras);
 * // later, before viewer.destroy():
 * layer.destroy();
 */
export function createCameraLayer(
  viewer: Viewer,
  onSelect: (cameraId: string) => void,
): CameraLayer {
  const pinBuilder = new PinBuilder();
  const billboards = viewer.scene.primitives.add(
    new BillboardCollection({scene: viewer.scene}),
  );
  let cameras: readonly CameraIndexEntry[] = [];
  const cameraById = new Map<string, CameraIndexEntry>();
  // Each camera's position on the globe, computed once per index load.
  const positionById = new Map<string, Cartesian3>();
  const screenScratch = new Cartesian2();
  let visibleCategories: ReadonlySet<CameraCategory> = new Set(
    CAMERA_CATEGORIES,
  );
  let selectedId: string | null = null;

  // Step 1: cached pin images.
  const pinImageByCategory = new Map<CameraCategory, string>();
  const pinImageFor = (category: CameraCategory): string => {
    let image = pinImageByCategory.get(category);
    if (image === undefined) {
      image = pinBuilder
        .fromColor(
          Color.fromCssColorString(CATEGORY_STYLES[category].color),
          CAMERA_PIN_SIZE_PX,
        )
        .toDataURL();
      pinImageByCategory.set(category, image);
    }
    return image;
  };
  const clusterImageByLabel = new Map<string, string>();
  const clusterImageFor = (count: number): string => {
    const label =
      count > MAX_CLUSTER_LABEL ? `${MAX_CLUSTER_LABEL}+` : String(count);
    let image = clusterImageByLabel.get(label);
    if (image === undefined) {
      image = pinBuilder
        .fromText(
          label,
          Color.fromCssColorString(CLUSTER_PIN_COLOR),
          CLUSTER_PIN_SIZE_PX,
        )
        .toDataURL();
      clusterImageByLabel.set(label, image);
    }
    return image;
  };

  // Step 2: where a camera's pin is on screen in the current view; `null`
  // (stay single) behind the Earth, off screen, or close to the ground.
  const screenPositionFinder = (): ((
    camera: CameraIndexEntry,
  ) => ScreenPosition | null) => {
    if (viewer.camera.positionCartographic.height < NO_CLUSTER_BELOW_METRES) {
      return () => null;
    }
    const occluder = new EllipsoidalOccluder(
      Ellipsoid.WGS84,
      viewer.camera.positionWC,
    );
    return camera => {
      const position = positionById.get(camera.id);
      if (position === undefined || !occluder.isPointVisible(position)) {
        return null;
      }
      const onScreen = viewer.scene.cartesianToCanvasCoordinates(
        position,
        screenScratch,
      );
      return onScreen === undefined ? null : {x: onScreen.x, y: onScreen.y};
    };
  };

  // Step 3: (re)build every billboard for the current cameras, filter,
  // selection, and view.
  const rebuild = (): void => {
    const visible = cameras.filter(camera =>
      visibleCategories.has(camera.category),
    );
    const keepIds = selectedId === null ? undefined : new Set([selectedId]);
    const {singles, clusters} = clusterPoints(visible, {
      positionOf: screenPositionFinder(),
      pixelRange: CLUSTER_PIXEL_RANGE,
      ...(keepIds === undefined ? {} : {keepIds}),
    });

    billboards.removeAll();
    for (const single of singles) {
      const camera = cameraById.get(single.id);
      if (camera === undefined) {
        continue;
      }
      const isSelected = camera.id === selectedId;
      billboards.add({
        id: {kind: 'camera', cameraId: camera.id} satisfies PinTarget,
        position:
          positionById.get(camera.id) ??
          Cartesian3.fromDegrees(camera.lng, camera.lat),
        image: pinImageFor(camera.category),
        verticalOrigin: VerticalOrigin.BOTTOM,
        disableDepthTestDistance: DISABLE_DEPTH_TEST_WITHIN_METRES,
        scale: isSelected ? SELECTED_PIN_SCALE : 1,
        eyeOffset: isSelected ? SELECTED_PIN_EYE_OFFSET : Cartesian3.ZERO,
      });
    }
    for (const cluster of clusters) {
      billboards.add({
        id: {kind: 'cluster', cluster} satisfies PinTarget,
        position: Cartesian3.fromDegrees(cluster.lng, cluster.lat),
        image: clusterImageFor(cluster.ids.length),
        verticalOrigin: VerticalOrigin.BOTTOM,
        disableDepthTestDistance: DISABLE_DEPTH_TEST_WITHIN_METRES,
      });
    }
    requestRender(viewer);
  };

  // Step 4: after the camera stops, re-cluster for the new view. About a
  // thousand projections take a few milliseconds, once per movement.
  const removeMoveEndListener = viewer.camera.moveEnd.addEventListener(rebuild);

  // Step 5: clicks. A single pin selects its camera; a cluster zooms to the
  // area its cameras cover.
  const clickHandler = new ScreenSpaceEventHandler(viewer.scene.canvas);
  clickHandler.setInputAction(
    (event: ScreenSpaceEventHandler.PositionedEvent) => {
      const picked: unknown = viewer.scene.pick(event.position);
      if (typeof picked !== 'object' || picked === null || !('id' in picked)) {
        return;
      }
      const target = asPinTarget(picked.id);
      if (target?.kind === 'camera') {
        onSelect(target.cameraId);
      } else if (target?.kind === 'cluster') {
        viewer.camera.flyTo({
          destination: clusterRectangle(target.cluster.ids, cameraById),
          duration: prefersReducedMotion() ? 0 : FLY_DURATION_SECONDS,
        });
      }
    },
    ScreenSpaceEventType.LEFT_CLICK,
  );

  return {
    setCameras(next) {
      cameras = next;
      cameraById.clear();
      positionById.clear();
      for (const camera of next) {
        cameraById.set(camera.id, camera);
        positionById.set(
          camera.id,
          Cartesian3.fromDegrees(camera.lng, camera.lat),
        );
      }
      rebuild();
    },

    setVisibleCategories(visible) {
      visibleCategories = visible;
      rebuild();
    },

    setSelected(cameraId) {
      if (cameraId === selectedId) {
        return;
      }
      selectedId = cameraId;
      rebuild();
    },

    flyTo(location) {
      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(
          location.lng,
          location.lat,
          FLY_TO_HEIGHT_METRES,
        ),
        duration: prefersReducedMotion() ? 0 : FLY_DURATION_SECONDS,
      });
    },

    destroy() {
      clickHandler.destroy();
      removeMoveEndListener();
      if (!viewer.isDestroyed()) {
        viewer.scene.primitives.remove(billboards);
      }
    },
  };
}
