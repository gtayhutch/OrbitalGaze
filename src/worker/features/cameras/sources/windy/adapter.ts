/**
 * @fileoverview Turns Windy webcams into OrbitalGaze cameras.
 *
 * Layer: worker feature, Windy source (server only).
 *
 * Pattern: Adapter. Windy's data model (numeric IDs, nested location, many
 * fine-grained categories, no time zone) is converted into the app's own
 * {@link NewCamera} shape here and nowhere else, so the rest of the app
 * never depends on Windy's field names.
 *
 * Also defines the Windy source record: its credit text, terms, and the
 * hosts browsers may load Windy images and players from.
 */
import tzLookup from '@photostructure/tz-lookup';

import type {CameraCategory} from '@/shared/cameras';

import type {NewCamera, NewSource} from '../../repository';
import type {WindyWebcam} from './schemas';

/** ID of the Windy source in the `sources` table. */
export const WINDY_SOURCE_ID = 'windy';

/**
 * The Windy source record, written by the import job before its cameras.
 *
 * `attributionText` is the credit Windy's terms require. `allowedHosts` are
 * the hosts Windy links may point at: images, players, and Windy's own
 * camera pages. A link from Windy is passed to browsers only if it is https
 * on one of them. The image and player hosts must match the
 * Content-Security-Policy in `public/_headers`. Windy's camera page links
 * (`urls.detail`) use the bare `windy.com` host, so both it and
 * `www.windy.com` are allowed.
 */
export const WINDY_SOURCE: NewSource = {
  id: WINDY_SOURCE_ID,
  name: 'Windy Webcams',
  homepageUrl: 'https://www.windy.com/',
  licenseName: 'Windy Webcams API terms of use',
  attributionText: 'Webcams provided by windy.com',
  allowedHosts: [
    'imgproxy.windy.com',
    'webcams.windy.com',
    'windy.com',
    'www.windy.com',
  ],
  // Stays off until the owner confirms Windy's terms for commercial use.
  commercialUseAllowed: false,
};

/** Longest title the database accepts. */
const MAX_TITLE_LENGTH = 200;

/** Longest place name the database accepts. */
const MAX_PLACE_LENGTH = 200;

/**
 * Our category for each Windy category ID, keyed in lower case. Windy's
 * list (`GET /webcams/api/v3/categories`, checked 2026-11-18) is: airport,
 * beach, building, city, coast, forest, indoor, lake, landscape, meteo,
 * mountain, observatory, port, river, sportArea, square, traffic, village.
 * Airport, indoor, and sportArea have no matching category of ours, so they
 * map to `other` by being left out.
 */
const CATEGORY_BY_WINDY_ID: Readonly<Record<string, CameraCategory>> = {
  traffic: 'traffic',
  beach: 'beach',
  coast: 'beach',
  meteo: 'weather',
  building: 'landmark',
  observatory: 'landmark',
  city: 'city',
  square: 'city',
  port: 'city',
  village: 'city',
  landscape: 'nature',
  mountain: 'nature',
  lake: 'nature',
  forest: 'nature',
  river: 'nature',
};

/**
 * When a webcam has several categories, the first of these that matches
 * wins. Specific subjects come before broad ones: a beach in a city is a
 * beach camera.
 */
const CATEGORY_PRIORITY: readonly CameraCategory[] = [
  'traffic',
  'beach',
  'weather',
  'landmark',
  'city',
  'nature',
];

/**
 * Picks our category for a webcam from Windy's category IDs.
 *
 * @param windyCategoryIds Windy's category IDs for the webcam.
 * @returns The best matching category, or `other`.
 * @example
 * toCameraCategory(['city', 'beach']); // 'beach'
 * toCameraCategory(['sportarea']); // 'other'
 */
export function toCameraCategory(
  windyCategoryIds: readonly string[],
): CameraCategory {
  const mapped = new Set(
    windyCategoryIds.map(id => CATEGORY_BY_WINDY_ID[id.toLowerCase()]),
  );
  return CATEGORY_PRIORITY.find(category => mapped.has(category)) ?? 'other';
}

/**
 * Works out a time zone from coordinates. Over open sea this is a nautical
 * zone such as `Etc/GMT+9`, which still gives the right local time.
 *
 * @param lat Latitude in decimal degrees.
 * @param lng Longitude in decimal degrees.
 * @returns The IANA time zone name, or `null` if the lookup fails.
 */
export function lookUpTimeZone(lat: number, lng: number): string | null {
  try {
    return tzLookup(lat, lng);
  } catch {
    return null;
  }
}

/**
 * Builds a place name such as "Zermatt, Valais" from the parts Windy gives.
 *
 * @param city The city, if known.
 * @param region The region, if known.
 * @returns The place name, or `null` when neither is known.
 */
function toPlaceName(
  city: string | null | undefined,
  region: string | null | undefined,
): string | null {
  const parts = [city, region]
    .map(part => part?.trim() ?? '')
    .filter(part => part !== '');
  // Skip the region when it repeats the city ("Paris, Paris").
  const unique = parts.filter((part, index) => parts.indexOf(part) === index);
  if (unique.length === 0) {
    return null;
  }
  return unique.join(', ').slice(0, MAX_PLACE_LENGTH);
}

/**
 * Converts one Windy webcam into a camera to store.
 *
 * @param webcam A validated Windy webcam.
 * @returns The camera. Its feed is the Windy webcam ID; the live image and
 *     player links are fetched fresh when someone opens the camera, because
 *     Windy's image links expire.
 * @example
 * toNewCamera(webcam).id; // 'windy-1358084658'
 */
export function toNewCamera(webcam: WindyWebcam): NewCamera {
  const {location} = webcam;
  const countryCode = location.country_code?.trim().toUpperCase() ?? '';
  return {
    id: `windy-${webcam.webcamId}`,
    sourceId: WINDY_SOURCE_ID,
    externalId: String(webcam.webcamId),
    title: webcam.title.slice(0, MAX_TITLE_LENGTH),
    lat: location.latitude,
    lng: location.longitude,
    countryCode: /^[A-Z]{2}$/.test(countryCode) ? countryCode : null,
    placeName: toPlaceName(location.city, location.region),
    timeZone: lookUpTimeZone(location.latitude, location.longitude),
    category: toCameraCategory(
      (webcam.categories ?? []).map(category => category.id),
    ),
    streamType: 'embed',
    streamRef: String(webcam.webcamId),
    status: webcam.status === 'active' ? 'online' : 'offline',
  };
}
