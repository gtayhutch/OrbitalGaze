/**
 * @fileoverview Public interface of the cameras feature (browser side).
 *
 * Layer: client feature (browser only).
 *
 * Data hooks, panels, and category styles for the camera layer. The Cesium
 * pins themselves live in the globe feature, which owns everything that
 * touches Cesium so it can be loaded lazily.
 */
export {CATEGORY_STYLES, type CategoryStyle} from './category_style';
export {fetchCamera, fetchCameraIndex, searchCameras} from './camera_api';
export {
  CameraDetailPanel,
  formatCoordinates,
  type CameraDetailPanelProps,
} from './camera_detail_panel';
export {LayerPanel, type LayerPanelProps} from './layer_panel';
export {useCameraDetail, type CameraDetailState} from './use_camera_detail';
export {useCameraIndex, type CameraIndexState} from './use_camera_index';
export {
  HIDDEN_CATEGORIES_STORAGE_KEY,
  useCategoryFilter,
  type CategoryFilter,
} from './use_category_filter';
