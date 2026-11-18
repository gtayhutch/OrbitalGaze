/**
 * @fileoverview Typed calls from the browser to the OrbitalGaze API.
 *
 * Layer: client library (browser only).
 *
 * Every response is checked against its shared schema before use. A response
 * that doesn't match is treated as an error, because the browser can't
 * assume the server (or anything between) sent what was expected.
 *
 * Successful bodies are `{data: …}`; this module unwraps them. Failed
 * requests become an {@link ApiRequestError} carrying the API's error code,
 * so screens can react to specific failures (for example "not found").
 */
import {z} from 'zod';

import {
  ApiErrorResponseSchema,
  type ApiErrorCode,
} from '@/shared/api/api_error';
import {dataEnvelope} from '@/shared/api/envelope';
import {HealthResponseSchema, type HealthResponse} from '@/shared/api/health';

/** Path of the health endpoint, relative to the site's origin. */
export const HEALTH_PATH = '/api/v1/health';

/** A failed API request, with the API's error code when it sent one. */
export class ApiRequestError extends Error {
  /**
   * @param status The HTTP status, or 0 if no response arrived.
   * @param code The API's error code, if the body was a valid error.
   */
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/**
 * Sends a GET request and returns the validated `data` payload.
 *
 * @param path The API path, starting with `/api/`.
 * @param payloadSchema The expected shape of `data`.
 * @param signal Cancels the request.
 * @returns The validated payload.
 * @throws {ApiRequestError} For a non-2xx status; `code` is set when the body
 *     was a valid API error.
 * @throws {Error} If the request couldn't be sent, was aborted, or the body
 *     doesn't match `payloadSchema`.
 * @example
 * const camera = await getJson('/api/v1/cameras/seed-0001', CameraDetailSchema);
 */
export async function getJson<Payload extends z.ZodType>(
  path: string,
  payloadSchema: Payload,
  signal?: AbortSignal,
): Promise<z.infer<Payload>> {
  const response = await fetch(path, signal === undefined ? {} : {signal});
  if (!response.ok) {
    // Read the API's error code if the body is a well-formed error.
    const errorBody = ApiErrorResponseSchema.safeParse(
      await response.json().catch(() => null),
    );
    const code = errorBody.success ? errorBody.data.error.code : undefined;
    throw new ApiRequestError(
      response.status,
      code,
      `Request to ${path} failed with status ${response.status}.`,
    );
  }
  // Check the envelope first, then the payload inside it.
  const {data} = AnyEnvelopeSchema.parse(await response.json());
  return payloadSchema.parse(data);
}

/** The success envelope with an unchecked payload; see {@link getJson}. */
const AnyEnvelopeSchema = dataEnvelope(z.unknown());

/**
 * Fetches the API's health status.
 *
 * @param signal Cancels the request, for example when a component unmounts.
 * @returns The validated health response.
 * @throws {Error} See {@link getJson}.
 * @example
 * const {environment} = await fetchHealth(controller.signal);
 */
export async function fetchHealth(
  signal?: AbortSignal,
): Promise<HealthResponse> {
  return getJson(HEALTH_PATH, HealthResponseSchema, signal);
}
