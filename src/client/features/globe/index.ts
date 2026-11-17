/**
 * @fileoverview Public interface of the globe feature.
 *
 * Layer: client feature (browser only).
 *
 * Other modules import the globe through this file only. Tests also mock this
 * file to replace the WebGL globe, which can't run in a simulated DOM.
 */
export {GlobeView, type GlobeStatus, type GlobeViewProps} from './globe_view';
