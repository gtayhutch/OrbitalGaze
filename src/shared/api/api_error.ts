/**
 * @fileoverview The single error shape every API endpoint returns.
 *
 * Layer: shared (the Worker produces it; the browser app parses it).
 *
 * Every failed API request, whatever went wrong, answers with the same JSON
 * body, so the browser needs only one way to read errors. Messages are written
 * for people and never contain stack traces, SQL, or other internals. The
 * `requestId` matches the Worker's log entry for that request, so a user's
 * error report can be traced without exposing anything sensitive.
 */
import {z} from 'zod';

/**
 * Machine-readable error categories, each tied to one HTTP status:
 *
 * - `bad_request` (400): the request was malformed or failed validation.
 * - `not_found` (404): no such route or resource.
 * - `rate_limited` (429): too many requests from this client; try later.
 * - `internal_error` (500): something failed on our side.
 */
export const API_ERROR_CODES = [
  'bad_request',
  'not_found',
  'rate_limited',
  'internal_error',
] as const;

/** Validates an error code against {@link API_ERROR_CODES}. */
export const ApiErrorCodeSchema = z.enum(API_ERROR_CODES);

/** One of the codes in {@link API_ERROR_CODES}. */
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

/** The JSON body of every API error response. */
export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
    requestId: z.string(),
  }),
});

/** A validated API error body. */
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
