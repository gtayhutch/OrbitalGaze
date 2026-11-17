/**
 * @fileoverview Public interface of the health feature.
 *
 * Layer: worker feature (server only).
 *
 * Other modules import the feature through this file only, never its inner
 * files, so the feature can be reorganized without breaking callers.
 */
export {healthRoutes} from './routes';
