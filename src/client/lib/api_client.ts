/**
 * @fileoverview Typed calls from the browser to the OrbitalGaze API.
 *
 * Layer: client library (browser only).
 *
 * Every response is checked against its shared schema before use. A response
 * that doesn't match is treated as an error, because the browser can't
 * assume the server (or anything between) sent what was expected.
 */
import {HealthResponseSchema, type HealthResponse} from '@/shared/api/health';

/** Path of the health endpoint, relative to the site's origin. */
export const HEALTH_PATH = '/api/v1/health';

/**
 * Fetches the API's health status.
 *
 * @param signal Cancels the request, for example when a component unmounts.
 * @returns The validated health response.
 * @throws {Error} If the request fails, the status isn't 2xx, or the body
 *     doesn't match the expected shape.
 * @example
 * const {environment} = await fetchHealth(controller.signal);
 */
export async function fetchHealth(
  signal?: AbortSignal,
): Promise<HealthResponse> {
  const response = await fetch(
    HEALTH_PATH,
    signal === undefined ? {} : {signal},
  );
  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}.`);
  }
  return HealthResponseSchema.parse(await response.json());
}
