/**
 * @fileoverview Unit tests for the browser's Zod setup.
 *
 * Layer: client tests.
 */
import {describe, expect, it} from 'vitest';
import {z} from 'zod';

import './zod_setup';

describe('zod_setup', () => {
  it('turns off compiled parsers so Zod never evaluates strings', () => {
    expect(z.config().jitless).toBe(true);
  });

  it('still validates objects with the plain parser', () => {
    const schema = z.object({id: z.string()});

    expect(schema.safeParse({id: 'windy-1'}).success).toBe(true);
    expect(schema.safeParse({id: 1}).success).toBe(false);
  });
});
