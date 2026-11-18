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
export {
  fetchCamera,
  fetchCameraFeed,
  fetchCameraIndex,
  searchCameras,
} from './camera_api';
export {
  BOTTOM_SHEET_HEIGHT_CLASS,
  CameraDetailPanel,
  formatCoordinates,
  type CameraDetailPanelProps,
} from './camera_detail_panel';
export {CameraPreview} from './camera_preview';
export {
  useCameraFeed,
  type CameraFeedResult,
  type CameraFeedState,
} from './use_camera_feed';
export {WebcamCredit} from './webcam_credit';
export {LayerPanel, type LayerPanelProps} from './layer_panel';
export {useCameraDetail, type CameraDetailState} from './use_camera_detail';
export {useCameraIndex, type CameraIndexState} from './use_camera_index';
export {
  HIDDEN_CATEGORIES_STORAGE_KEY,
  useCategoryFilter,
  type CategoryFilter,
} from './use_category_filter';
