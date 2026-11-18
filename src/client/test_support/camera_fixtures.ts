/**
 * @fileoverview Test data for camera screens.
 *
 * Layer: client test support (jsdom only).
 */
import type {CameraDetail, CameraIndexEntry} from '@/shared/cameras';

/**
 * Builds a camera's details with sensible defaults.
 *
 * @param overrides Fields to change.
 * @returns A valid `CameraDetail`.
 */
export function buildCameraDetail(
  overrides: Partial<CameraDetail> = {},
): CameraDetail {
  return {
    id: 'cam-1',
    title: 'Tokyo Tower view',
    lat: 35.6586,
    lng: 139.7454,
    countryCode: 'JP',
    placeName: 'Tokyo',
    timeZone: 'Asia/Tokyo',
    category: 'landmark',
    status: 'online',
    hasFeed: false,
    attribution: {
      sourceName: 'Test Source',
      licenseName: 'Test license',
      attributionText: 'Courtesy of the test source',
      homepageUrl: 'https://example.com',
    },
    ...overrides,
  };
}

/** A small index: two city cameras, one landmark, one beach. */
export const SAMPLE_INDEX: readonly CameraIndexEntry[] = [
  {id: 'cam-1', lat: 35.6586, lng: 139.7454, category: 'landmark'},
  {id: 'cam-2', lat: 40.7128, lng: -74.006, category: 'city'},
  {id: 'cam-3', lat: 51.5072, lng: -0.1276, category: 'city'},
  {id: 'cam-4', lat: -33.8908, lng: 151.2743, category: 'beach'},
];
