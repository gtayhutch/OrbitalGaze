/**
 * @fileoverview Browser calls to the camera API.
 *
 * Layer: client feature (browser only).
 *
 * Thin wrappers over `getJson` that name each endpoint and the shape it
 * returns. Every response is validated against the shared camera schemas.
 */
import {getJson} from '@/client/lib/api_client';
import {
  CameraDetailSchema,
  CameraFeedSchema,
  CameraIndexSchema,
  CameraSearchResponseSchema,
  type CameraDetail,
  type CameraFeed,
  type CameraIndex,
  type CameraSearchResponse,
} from '@/shared/cameras';

/**
 * Fetches the pins for every online camera.
 *
 * @param signal Cancels the request.
 * @returns The camera index.
 * @throws {Error} See `getJson`.
 */
export async function fetchCameraIndex(
  signal?: AbortSignal,
): Promise<CameraIndex> {
  return getJson('/api/v1/cameras/index', CameraIndexSchema, signal);
}

/**
 * Fetches one camera's details.
 *
 * @param id The camera's ID. It is URL-encoded here.
 * @param signal Cancels the request.
 * @returns The camera.
 * @throws {ApiRequestError} With code `NOT_FOUND` if the camera doesn't exist
 *     or isn't public.
 */
export async function fetchCamera(
  id: string,
  signal?: AbortSignal,
): Promise<CameraDetail> {
  return getJson(
    `/api/v1/cameras/${encodeURIComponent(id)}`,
    CameraDetailSchema,
    signal,
  );
}

/**
 * Fetches a camera's current image and player links.
 *
 * @param id The camera's ID. It is URL-encoded here.
 * @param signal Cancels the request.
 * @returns The feed. Its links stop working at `expiresAt`.
 * @throws {ApiRequestError} With code `NOT_FOUND` if the camera has no
 *     preview, or `INTERNAL` if the provider can't be reached.
 */
export async function fetchCameraFeed(
  id: string,
  signal?: AbortSignal,
): Promise<CameraFeed> {
  return getJson(
    `/api/v1/cameras/${encodeURIComponent(id)}/feed`,
    CameraFeedSchema,
    signal,
  );
}

/**
 * Searches cameras by name, place, or category.
 *
 * @param query The visitor's search text.
 * @param signal Cancels the request (for example when the visitor keeps typing).
 * @returns Up to 20 results, best first.
 * @throws {ApiRequestError} With code `RATE_LIMITED` after too many searches.
 */
export async function searchCameras(
  query: string,
  signal?: AbortSignal,
): Promise<CameraSearchResponse> {
  return getJson(
    `/api/v1/cameras/search?q=${encodeURIComponent(query)}`,
    CameraSearchResponseSchema,
    signal,
  );
}
