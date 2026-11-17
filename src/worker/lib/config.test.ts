/**
 * @fileoverview Unit tests for Worker configuration parsing.
 *
 * Layer: worker tests.
 */
import {describe, expect, it} from 'vitest';

import {ConfigError, parseWorkerConfig} from './config';

describe('parseWorkerConfig', () => {
  it('accepts each known environment', () => {
    for (const environment of ['test', 'staging', 'production'] as const) {
      expect(parseWorkerConfig({APP_ENV: environment})).toEqual({
        appEnvironment: environment,
      });
    }
  });

  it('ignores bindings and other unknown keys', () => {
    expect(parseWorkerConfig({APP_ENV: 'test', DB: {}, OTHER: 1})).toEqual({
      appEnvironment: 'test',
    });
  });

  it('rejects a missing environment', () => {
    expect(() => parseWorkerConfig({})).toThrow(ConfigError);
  });

  it('rejects an unknown environment and names the setting, not its value', () => {
    expect(() => parseWorkerConfig({APP_ENV: 'secret-value'})).toThrow(
      /APP_ENV/,
    );
    expect(() => parseWorkerConfig({APP_ENV: 'secret-value'})).not.toThrow(
      /secret-value/,
    );
  });
});
