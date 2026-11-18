/**
 * @fileoverview Draws camera pins on the globe, clusters them, and handles clicks.
 *
 * Layer: client feature (browser only). Created and driven by `globe_view.tsx`.
 *
 * Pins are Cesium entities in one `CustomDataSource`. Cesium's built-in
 * clustering (`EntityCluster`) merges pins that would overlap on screen into
 * one numbered pin, recalculated as the camera moves. Clicking a single pin
 * selects that camera; clicking a numbered cluster zooms in on its cameras.
 *
 * Pin images are drawn once per category (and once per cluster count) with
 * Cesium's `PinBuilder` and cached, so thousands of pins share a handful of
 * images.
 */
import {
  Cartesian3,
  Color,
  CustomDataSource,
  Entity,
  PinBuilder,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  type Viewer,
} from 'cesium';

import {prefersReducedMotion} from '@/client/lib/motion';
import {CATEGORY_STYLES} from '@/client/features/cameras';
import {
  CAMERA_CATEGORIES,
  type CameraCategory,
  type CameraIndexEntry,
} from '@/shared/cameras';

/** Pin height for a single camera, in screen pixels. */
const CAMERA_PIN_SIZE_PX = 36;

/** Pin height for a cluster, in screen pixels. */
const CLUSTER_PIN_SIZE_PX = 48;

/** Color of cluster pins (the app's teal accent, darkened for contrast with white digits). */
const CLUSTER_PIN_COLOR = '#0f766e';

/** Pins closer than this many screen pixels are merged into a cluster. */
const CLUSTER_PIXEL_RANGE = 45;

/** Smallest group of overlapping pins that becomes a cluster. */
const MIN_CLUSTER_SIZE = 3;

/** Clusters larger than this show "999+" instead of the exact count. */
const MAX_CLUSTER_LABEL = 999;

/**
 * Height above the ground, in meters, when flying to a camera: about a city's
 * width in view.
 */
const FLY_TO_HEIGHT_METERS = 40_000;

/** Duration of a camera flight, in seconds (0 with reduced motion). */
const FLY_DURATION_SECONDS = 2;

/** What the globe view can do with the camera pins. */
export interface CameraLayer {
  /** Replaces all pins. */
  setCameras(cameras: readonly CameraIndexEntry[]): void;
  /** Shows only pins in these categories. */
  setVisibleCategories(visible: ReadonlySet<CameraCategory>): void;
  /** Flies the view to a point above the given location. */
  flyTo(location: {readonly lat: number; readonly lng: number}): void;
  /** Removes the pins and click handling. Call before destroying the viewer. */
  destroy(): void;
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
  const dataSource = new CustomDataSource('cameras');
  const categoryById = new Map<string, CameraCategory>();
  let visibleCategories: ReadonlySet<CameraCategory> = new Set(
    CAMERA_CATEGORIES,
  );

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

  // Step 2: clustering. Cesium calls the listener for each cluster it forms;
  // the default label is replaced with a numbered pin.
  const clustering = dataSource.clustering;
  clustering.enabled = true;
  clustering.pixelRange = CLUSTER_PIXEL_RANGE;
  clustering.minimumClusterSize = MIN_CLUSTER_SIZE;
  const removeClusterListener = clustering.clusterEvent.addEventListener(
    (clusteredEntities: Entity[], cluster) => {
      cluster.label.show = false;
      cluster.billboard.show = true;
      // The label's `id` holds the clustered entities; copying it to the
      // billboard makes a click on the numbered pin return them.
      const clusteredEntitiesId: unknown = cluster.label.id;
      cluster.billboard.id = clusteredEntitiesId;
      cluster.billboard.verticalOrigin = VerticalOrigin.BOTTOM;
      cluster.billboard.image = clusterImageFor(clusteredEntities.length);
    },
  );
  void viewer.dataSources.add(dataSource);

  // Step 3: clicks. A picked single pin has an Entity as its `id`; a picked
  // cluster has the array of entities it contains.
  const clickHandler = new ScreenSpaceEventHandler(viewer.scene.canvas);
  clickHandler.setInputAction(
    (event: ScreenSpaceEventHandler.PositionedEvent) => {
      const picked: unknown = viewer.scene.pick(event.position);
      if (typeof picked !== 'object' || picked === null || !('id' in picked)) {
        return;
      }
      const target: unknown = picked.id;
      if (target instanceof Entity && categoryById.has(target.id)) {
        onSelect(target.id);
        return;
      }
      if (Array.isArray(target)) {
        const entities = target.filter(
          (item): item is Entity => item instanceof Entity,
        );
        void viewer.flyTo(entities, {
          duration: prefersReducedMotion() ? 0 : FLY_DURATION_SECONDS,
        });
      }
    },
    ScreenSpaceEventType.LEFT_CLICK,
  );

  /** Applies the category filter to every pin, then redraws. */
  const applyVisibility = (): void => {
    for (const entity of dataSource.entities.values) {
      const category = categoryById.get(entity.id);
      entity.show = category !== undefined && visibleCategories.has(category);
    }
    viewer.scene.requestRender();
  };

  return {
    setCameras(cameras) {
      // Suspend change events so thousands of additions trigger one update.
      dataSource.entities.suspendEvents();
      dataSource.entities.removeAll();
      categoryById.clear();
      for (const camera of cameras) {
        categoryById.set(camera.id, camera.category);
        dataSource.entities.add({
          id: camera.id,
          position: Cartesian3.fromDegrees(camera.lng, camera.lat),
          billboard: {
            image: pinImageFor(camera.category),
            verticalOrigin: VerticalOrigin.BOTTOM,
          },
        });
      }
      dataSource.entities.resumeEvents();
      applyVisibility();
    },

    setVisibleCategories(visible) {
      visibleCategories = visible;
      applyVisibility();
    },

    flyTo(location) {
      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(
          location.lng,
          location.lat,
          FLY_TO_HEIGHT_METERS,
        ),
        duration: prefersReducedMotion() ? 0 : FLY_DURATION_SECONDS,
      });
    },

    destroy() {
      clickHandler.destroy();
      removeClusterListener();
      if (!viewer.isDestroyed()) {
        viewer.dataSources.remove(dataSource, true);
      }
    },
  };
}
