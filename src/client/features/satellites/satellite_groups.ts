/**
 * @fileoverview How each satellite group looks and is named.
 *
 * Layer: client feature (browser only). Pure data, used by the layer panel,
 * the detail panel and the deck.gl overlay, so every view of a group uses
 * the same label and colour.
 */
import {SATELLITE_GROUPS, type SatelliteGroup} from '@/shared/satellites';

/** How one group is shown. */
export interface SatelliteGroupStyle {
  /** Label in the layer panel and detail panel. */
  readonly label: string;
  /** CSS colour of the group's dots and swatches. */
  readonly color: string;
  /** The same colour as RGB bytes, for deck.gl. */
  readonly rgb: readonly [number, number, number];
}

/** Every group's label and colour, in panel order. */
export const SATELLITE_GROUP_STYLES: Readonly<
  Record<SatelliteGroup, SatelliteGroupStyle>
> = {
  stations: {label: 'Space stations', color: '#facc15', rgb: [250, 204, 21]},
  starlink: {label: 'Starlink', color: '#5eead4', rgb: [94, 234, 212]},
  internet: {
    label: 'Other internet constellations',
    color: '#38bdf8',
    rgb: [56, 189, 248],
  },
  navigation: {
    label: 'Navigation (GPS, Galileo and others)',
    color: '#4ade80',
    rgb: [74, 222, 128],
  },
  weather: {
    label: 'Weather and Earth observation',
    color: '#fb923c',
    rgb: [251, 146, 60],
  },
  science: {label: 'Science', color: '#c084fc', rgb: [192, 132, 252]},
  geostationary: {
    label: 'Geostationary',
    color: '#f472b6',
    rgb: [244, 114, 182],
  },
  other: {label: 'Other', color: '#cbd5e1', rgb: [203, 213, 225]},
};

/** Every group, in panel order. */
export const ALL_SATELLITE_GROUPS: ReadonlySet<SatelliteGroup> = new Set(
  SATELLITE_GROUPS,
);
