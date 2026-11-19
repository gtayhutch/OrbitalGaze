/**
 * @fileoverview Public interface of the globe feature.
 *
 * Layer: client feature (browser only).
 *
 * Everything that touches MapLibre lives in this feature, so the app shell
 * can load it lazily as one bundle. Tests mock this file to replace the WebGL
 * globe, which can't run in a simulated DOM. Import only types from here
 * outside the lazy boundary, or the map library joins the first bundle.
 */
export type {GlobeMapStyle} from './basemap_style';
export type {CameraView} from './camera_view';
export {
  GlobeView,
  type GlobeFocus,
  type GlobeStatus,
  type GlobeViewProps,
} from './globe_view';
