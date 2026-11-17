/**
 * @fileoverview Public interface of the cameras feature.
 *
 * Layer: worker feature (server only).
 *
 * Other modules import the feature through this file only, never its inner
 * files.
 */
export {cameraRoutes} from './routes';
export {
  createCameraRepository,
  type CameraRepository,
  type NewCamera,
  type NewSource,
} from './repository';
