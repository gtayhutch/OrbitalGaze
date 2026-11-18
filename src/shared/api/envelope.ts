/**
 * @fileoverview The wrapper around every successful API response.
 *
 * Layer: shared.
 *
 * Successful responses are always `{data: …}`; failures are always
 * `{error: …}` (see `api_error.ts`). Wrapping success bodies means new
 * top-level fields (for example paging details) can be added later without
 * changing what `data` contains.
 */
import {z} from 'zod';

/**
 * Builds the schema for a successful response whose payload matches `schema`.
 *
 * @param schema Schema of the payload inside `data`.
 * @returns A schema for `{data: <payload>}`.
 * @example
 * const HealthEnvelopeSchema = dataEnvelope(HealthResponseSchema);
 * const {data} = HealthEnvelopeSchema.parse(await response.json());
 */
export function dataEnvelope<Payload extends z.ZodType>(
  schema: Payload,
): z.ZodObject<{data: Payload}> {
  return z.object({data: schema});
}
