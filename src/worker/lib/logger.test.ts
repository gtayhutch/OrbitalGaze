/**
 * @fileoverview Unit tests for the structured logger.
 *
 * Layer: worker tests.
 */
import {describe, expect, it} from 'vitest';
import {z} from 'zod';

import {createLogger} from './logger';

/** Reads just the level from a log line. */
const LevelOnlySchema = z.object({level: z.string()});

describe('createLogger', () => {
  it('writes one JSON line with the level, message, base fields, and call fields', () => {
    const lines: string[] = [];
    const logger = createLogger({requestId: 'abc'}, line => lines.push(line));

    logger.info('request completed', {status: 200});

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      level: 'info',
      message: 'request completed',
      requestId: 'abc',
      status: 200,
    });
  });

  it('uses the right level for each method', () => {
    const levels: string[] = [];
    const logger = createLogger({}, line => {
      levels.push(LevelOnlySchema.parse(JSON.parse(line)).level);
    });

    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');

    expect(levels).toEqual(['debug', 'info', 'warn', 'error']);
  });
});
