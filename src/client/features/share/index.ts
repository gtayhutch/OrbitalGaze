/**
 * @fileoverview Public interface of the share feature.
 *
 * Layer: client feature (browser only).
 *
 * Share links: the link text format for the globe's view and active layers,
 * building the link to copy, and the "Share this view" button.
 */
export {ShareButton, type ShareButtonProps} from './share_button';
export {buildShareUrl} from './share_url';
export {
  decodeLayers,
  decodeView,
  encodeLayers,
  encodeView,
  LAYERS_URL_PARAM,
  VIEW_URL_PARAM,
} from './view_codec';
