/**
 * @fileoverview Public interface of the satellites feature.
 *
 * Layer: client feature (browser only).
 *
 * Everything here is light: the heavy parts (deck.gl, satellite.js) load
 * only when the layer is switched on, from `use_satellites.ts` (the overlay,
 * by dynamic import) and the orbit worker (a separate script).
 */
export {
  SatelliteControls,
  type SatelliteControlsProps,
} from './satellite_controls';
export {
  SatelliteDetailPanel,
  type SatelliteDetailPanelProps,
} from './satellite_detail_panel';
export {SATELLITE_GROUP_STYLES} from './satellite_groups';
export type {OrbitCatalog} from './orbit_protocol';
export {searchSatellites} from './search_satellites';
export {
  HIDDEN_SATELLITE_GROUPS_STORAGE_KEY,
  useSatelliteGroups,
  type SatelliteGroupFilter,
} from './use_satellite_groups';
export {
  useSatellites,
  type FollowedSatellite,
  type SatellitesState,
  type UseSatellitesResult,
} from './use_satellites';
