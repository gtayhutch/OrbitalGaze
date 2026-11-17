/**
 * @fileoverview The response contract for `GET /api/v1/health`.
 *
 * Layer: shared (the Worker produces this shape; the browser app parses it).
 *
 * Keeping the schema here means both sides agree on the shape at compile time,
 * and the browser still validates what it receives at run time, because a
 * response is untrusted input until it has been checked.
 */
import {z} from 'zod';

import {AppEnvironmentSchema} from '../app_environment';

/**
 * Body returned by the health endpoint.
 *
 * - `status` is always `"ok"` when the Worker can answer at all.
 * - `environment` names the environment that answered (see
 *   `AppEnvironment`), which the browser uses for the environment badge.
 */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  environment: AppEnvironmentSchema,
});

/** A validated health response. */
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
