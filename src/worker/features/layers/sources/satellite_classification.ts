/**
 * @fileoverview Sorts satellites into the layer's neutral display groups.
 *
 * Layer: worker feature (server only). Pure and unit-tested; used by the
 * Space-Track source.
 *
 * Space-Track publishes the catalogue without groups, so they are derived
 * from what every record has: the object's official name and its orbit.
 * - Names identify the well-known families (space stations, Starlink and
 *   other internet constellations, navigation systems, weather and Earth
 *   observation, science missions). The lists are prefixes of official
 *   catalogue names and are meant to be extended over time.
 * - Orbits identify what names can't: navigation constellations in their
 *   characteristic medium orbits (GLONASS satellites are catalogued as
 *   "COSMOS nnnn") and geostationary satellites.
 * - Everything else is "other".
 *
 * The groups only colour and filter the dots; they make no claim about an
 * object's owner or purpose beyond its published name and orbit.
 */
import type {SatelliteGroup} from '@/shared/satellites';

/** Catalogue numbers of the crewed stations' core modules. */
const STATION_IDS: ReadonlySet<number> = new Set([
  25544, // ISS (ZARYA)
  48274, // CSS (TIANHE)
]);

/** Name prefixes for each named family, checked in this order. */
const NAME_RULES: readonly {
  group: SatelliteGroup;
  prefixes: readonly string[];
}[] = [
  {group: 'stations', prefixes: ['ISS ', 'CSS ', 'TIANGONG']},
  {group: 'starlink', prefixes: ['STARLINK']},
  {
    group: 'internet',
    prefixes: [
      'ONEWEB',
      'KUIPER',
      'QIANFAN',
      'GUOWANG',
      'HULIANWANG',
      'SPACEMOBILE',
      'BLUEBIRD',
      'LYNK',
      'O3B',
      'IRIDIUM',
      'GLOBALSTAR',
      'ORBCOMM',
    ],
  },
  {
    group: 'navigation',
    prefixes: [
      'NAVSTAR',
      'GPS ',
      'GALILEO',
      'GSAT0',
      'BEIDOU',
      'GLONASS',
      'QZS',
      'IRNSS',
      'NVS',
    ],
  },
  {
    group: 'weather',
    prefixes: [
      'NOAA',
      'GOES',
      'METEOSAT',
      'METOP',
      'HIMAWARI',
      'FENGYUN',
      'FY-',
      'ELEKTRO',
      'METEOR-M',
      'GOMS',
      'INSAT-3D',
      'GK-2A',
      'SUOMI NPP',
      'JPSS',
      'SENTINEL',
      'LANDSAT',
      'TERRA',
      'AQUA',
      'AURA',
      'SPOT ',
      'PLEIADES',
      'WORLDVIEW',
      'FLOCK',
      'LEMUR',
      'GAOFEN',
      'RESURS',
      'KOMPSAT',
      'RADARSAT',
      'CRYOSAT',
      'GRACE',
      'SMAP',
      'ICESAT',
    ],
  },
  {
    group: 'science',
    prefixes: [
      'HST',
      'HUBBLE',
      'TESS',
      'SWIFT',
      'FERMI',
      'NUSTAR',
      'CHANDRA',
      'XMM',
      'INTEGRAL',
      'NICER',
      'IXPE',
      'GAIA',
      'CHEOPS',
      'HXMT',
      'EINSTEIN PROBE',
      'SVOM',
      'XRISM',
    ],
  },
];

/** Medium orbits of the navigation constellations (GPS, GLONASS, Galileo, BeiDou). */
const NAVIGATION_ORBIT = {
  minMeanMotion: 1.7,
  maxMeanMotion: 2.3,
  maxEccentricity: 0.03,
  minInclination: 50,
  maxInclination: 66,
} as const;

/** Geostationary: one revolution per (sidereal) day, nearly circular. */
const GEOSTATIONARY_ORBIT = {
  minMeanMotion: 0.98,
  maxMeanMotion: 1.02,
  maxEccentricity: 0.01,
} as const;

/** The orbit facts classification reads. */
export interface ClassifiableSatellite {
  /** NORAD catalogue number. */
  readonly id: number;
  /** Official catalogue name, for example `ISS (ZARYA)`. */
  readonly name: string;
  /** Revolutions per day. */
  readonly meanMotion: number;
  readonly eccentricity: number;
  /** Degrees. */
  readonly inclination: number;
}

/**
 * The display group for one satellite.
 *
 * @param satellite Its catalogue number, name and orbit.
 * @returns The group: by station ID, then name, then orbit, else `other`.
 * @example
 * classifySatellite({id: 25544, name: 'ISS (ZARYA)', meanMotion: 15.5, eccentricity: 0.0004, inclination: 51.6}); // 'stations'
 * classifySatellite({id: 32276, name: 'COSMOS 2424', meanMotion: 2.13, eccentricity: 0.001, inclination: 64.8}); // 'navigation'
 */
export function classifySatellite(
  satellite: ClassifiableSatellite,
): SatelliteGroup {
  if (STATION_IDS.has(satellite.id)) {
    return 'stations';
  }
  const name = satellite.name.toUpperCase();
  for (const rule of NAME_RULES) {
    if (rule.prefixes.some(prefix => name.startsWith(prefix))) {
      return rule.group;
    }
  }
  const {meanMotion, eccentricity, inclination} = satellite;
  if (
    meanMotion >= NAVIGATION_ORBIT.minMeanMotion &&
    meanMotion <= NAVIGATION_ORBIT.maxMeanMotion &&
    eccentricity <= NAVIGATION_ORBIT.maxEccentricity &&
    inclination >= NAVIGATION_ORBIT.minInclination &&
    inclination <= NAVIGATION_ORBIT.maxInclination
  ) {
    return 'navigation';
  }
  if (
    meanMotion >= GEOSTATIONARY_ORBIT.minMeanMotion &&
    meanMotion <= GEOSTATIONARY_ORBIT.maxMeanMotion &&
    eccentricity <= GEOSTATIONARY_ORBIT.maxEccentricity
  ) {
    return 'geostationary';
  }
  return 'other';
}
