/**
 * @fileoverview Test data for camera screens.
 *
 * Layer: client test support (jsdom only).
 */
import type {
  CameraDetail,
  CameraFeed,
  CameraIndexEntry,
} from '@/shared/cameras';

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

/**
 * Builds a camera feed (Windy-style links) with sensible defaults. The links
 * expire ten minutes after `now`.
 *
 * @param overrides Fields to change.
 * @param now The time the feed was fetched.
 * @returns A valid `CameraFeed`.
 */
export function buildCameraFeed(
  overrides: Partial<CameraFeed> = {},
  now = new Date(),
): CameraFeed {
  return {
    kind: 'windy',
    imageUrl:
      'https://imgproxy.windy.com/_/preview/plain/current/1/original.jpg?token=t1',
    imageWidth: 400,
    imageHeight: 224,
    pageUrl: 'https://www.windy.com/webcams/1',
    timelapseUrl: 'https://webcams.windy.com/webcams/public/embed/player/1/day',
    liveUrl: null,
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
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
