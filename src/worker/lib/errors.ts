/**
 * @fileoverview Application errors and how they become API responses.
 *
 * Layer: worker library (server only).
 *
 * Feature code throws {@link AppError} for failures it expects (bad input,
 * missing resources). The app's error handler turns those into the shared
 * error body with the matching status. Any other thrown value is treated as a
 * bug: it is logged in full and the client gets a generic 500, so internal
 * details never leak.
 */
import type {ContentfulStatusCode} from 'hono/utils/http-status';

import type {ApiErrorCode, ApiErrorResponse} from '@/shared/api/api_error';

/** The HTTP status that goes with each error code. */
export const STATUS_BY_ERROR_CODE: Readonly<
  Record<ApiErrorCode, ContentfulStatusCode>
> = {
  bad_request: 400,
  not_found: 404,
  rate_limited: 429,
  internal_error: 500,
};

/**
 * An expected failure whose message is safe to show to the user.
 *
 * @example
 * throw new AppError('not_found', 'No camera with that ID.');
 */
export class AppError extends Error {
  /**
   * @param code The error category; it decides the HTTP status.
   * @param publicMessage A short message for the user. It is sent to the
   *     client as is, so it must not contain internal details.
   */
  constructor(
    readonly code: ApiErrorCode,
    readonly publicMessage: string,
  ) {
    super(publicMessage);
    this.name = 'AppError';
  }

  /** The HTTP status for this error's code. */
  get status(): ContentfulStatusCode {
    return STATUS_BY_ERROR_CODE[this.code];
  }
}

/**
 * Builds the JSON body for an error response.
 *
 * @param code The error category.
 * @param message A user-facing message.
 * @param requestId The ID of the request that failed, for support and logs.
 * @returns The body in the shared error shape.
 */
export function buildErrorBody(
  code: ApiErrorCode,
  message: string,
  requestId: string,
): ApiErrorResponse {
  return {error: {code, message, requestId}};
}
