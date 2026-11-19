/**
 * @fileoverview Public interface of the map style feature (dark map or satellite imagery).
 *
 * Layer: client feature (browser only). Light: the globe applies the style;
 * this feature only holds the choice and its switch.
 */
export {MapStyleSwitch, type MapStyleSwitchProps} from './map_style_switch';
export {
  MAP_STYLE_STORAGE_KEY,
  MAP_STYLE_URL_PARAM,
  useMapStyle,
  type MapStyle,
  type MapStyleState,
} from './use_map_style';
