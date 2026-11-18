/**
 * @fileoverview Test data factories for sources and cameras.
 *
 * Layer: worker test support (runs inside workerd during `pnpm test` only).
 *
 * Each factory returns a complete, valid record with sensible defaults; tests
 * override only the fields they care about. Records are written through the
 * real repository, so tests exercise the same insert path (including the
 * search table) as the app.
 */
import {env} from 'cloudflare:workers';

import {
  createCameraRepository,
  type NewCamera,
  type NewSource,
} from '../features/cameras';

/** Counter that keeps generated IDs unique within a test file. */
let nextSequence = 1;

/** Returns a new unique number for IDs. */
function sequence(): number {
  return nextSequence++;
}

/**
 * Builds a source record.
 *
 * @param overrides Fields to change from the defaults.
 * @returns A valid source.
 */
export function buildSource(overrides: Partial<NewSource> = {}): NewSource {
  const number = sequence();
  return {
    id: `test-source-${number}`,
    name: `Test Source ${number}`,
    homepageUrl: 'https://example.com',
    licenseName: 'Test license',
    attributionText: 'Courtesy of the test source',
    allowedHosts: ['images.example.com'],
    commercialUseAllowed: false,
    ...overrides,
  };
}

/**
 * Builds a camera record for `sourceId`.
 *
 * @param sourceId The source the camera belongs to.
 * @param overrides Fields to change from the defaults.
 * @returns A valid, online camera with no feed.
 */
export function buildCamera(
  sourceId: string,
  overrides: Partial<NewCamera> = {},
): NewCamera {
  const number = sequence();
  return {
    id: `test-camera-${number}`,
    sourceId,
    externalId: `external-${number}`,
    title: `Harbor view ${number}`,
    lat: 35.68,
    lng: 139.76,
    countryCode: 'JP',
    placeName: 'Tokyo',
    timeZone: 'Asia/Tokyo',
    category: 'city',
    streamType: null,
    streamRef: null,
    status: 'online',
    ...overrides,
  };
}

/**
 * Stores a source and the given cameras in the test database.
 *
 * @param cameraOverrides One entry per camera to create.
 * @returns The stored source and cameras.
 * @example
 * const {cameras} = await seedCameras([{title: 'Tokyo Tower'}, {status: 'hidden'}]);
 */
export async function seedCameras(
  cameraOverrides: ReadonlyArray<Partial<NewCamera>>,
): Promise<{source: NewSource; cameras: NewCamera[]}> {
  const repository = createCameraRepository(env.DB);
  const source = buildSource();
  await repository.insertSource(source);
  const cameras = cameraOverrides.map(overrides =>
    buildCamera(source.id, overrides),
  );
  await repository.insertCameras(cameras);
  return {source, cameras};
}
