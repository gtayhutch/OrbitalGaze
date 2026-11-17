/**
 * @fileoverview Turns untrusted request input into typed values, or a 400.
 *
 * Layer: worker library (server only).
 *
 * Every route parses its path parameters and query strings through
 * {@link parseInput} with a Zod schema before using them. Invalid input
 * becomes an `INVALID_INPUT` error listing what is wrong with each field, so
 * route handlers only ever see values that already passed validation.
 */
import type {z} from 'zod';

import {AppError} from './errors';

/**
 * Validates `input` against `schema`.
 *
 * @param schema The shape the input must have.
 * @param input The raw input, for example `{id: c.req.param('id')}`.
 * @returns The parsed, typed value.
 * @throws {AppError} `INVALID_INPUT` with per-field messages if the input
 *     doesn't match.
 * @example
 * const {id} = parseInput(z.object({id: CameraIdSchema}), {id: c.req.param('id')});
 */
export function parseInput<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.infer<Schema> {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  // Group the messages by top-level field name ("(input)" for the whole value).
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const field = issue.path.length > 0 ? String(issue.path[0]) : '(input)';
    (fieldErrors[field] ??= []).push(issue.message);
  }
  throw new AppError(
    'INVALID_INPUT',
    'Some of the request is invalid.',
    fieldErrors,
  );
}
