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
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/** Messages per invalid input field, keyed by field name. */
export type FieldErrors = Readonly<Record<string, readonly string[]>>;

/**
 * An expected failure whose message is safe to show to the user.
 *
 * @example
 * throw new AppError('NOT_FOUND', 'This camera isn\'t available.');
 * throw new AppError('INVALID_INPUT', 'Check your search.', {q: ['Too long.']});
 */
export class AppError extends Error {
  /**
   * @param code The error category; it decides the HTTP status.
   * @param publicMessage A short message for the user. It is sent to the
   *     client as is, so it must not contain internal details.
   * @param fieldErrors For `INVALID_INPUT`: what is wrong with each field.
   */
  constructor(
    readonly code: ApiErrorCode,
    readonly publicMessage: string,
    readonly fieldErrors?: FieldErrors,
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
 * @param fieldErrors Optional per-field messages for invalid input.
 * @returns The body in the shared error shape.
 */
export function buildErrorBody(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  fieldErrors?: FieldErrors,
): ApiErrorResponse {
  if (fieldErrors === undefined) {
    return {error: {code, message, requestId}};
  }
  // Copy into plain mutable arrays to match the shared response type.
  const copiedFieldErrors = Object.fromEntries(
    Object.entries(fieldErrors).map(([field, messages]) => [
      field,
      [...messages],
    ]),
  );
  return {error: {code, message, requestId, fieldErrors: copiedFieldErrors}};
}
