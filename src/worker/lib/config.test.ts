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
      expect(
        parseWorkerConfig({APP_ENV: environment, WINDY_API_KEY: 'key'}),
      ).toEqual({appEnvironment: environment, windyApiKey: 'key'});
    }
  });

  it('ignores bindings and other unknown keys', () => {
    expect(parseWorkerConfig({APP_ENV: 'test', DB: {}, OTHER: 1})).toEqual({
      appEnvironment: 'test',
      windyApiKey: null,
    });
  });

  it('treats a missing or empty Windy key as not set locally', () => {
    expect(parseWorkerConfig({APP_ENV: 'test'}).windyApiKey).toBeNull();
    expect(
      parseWorkerConfig({APP_ENV: 'test', WINDY_API_KEY: ''}).windyApiKey,
    ).toBeNull();
  });

  it('requires the Windy key in hosted environments without revealing values', () => {
    for (const environment of ['staging', 'production'] as const) {
      expect(() => parseWorkerConfig({APP_ENV: environment})).toThrow(
        /WINDY_API_KEY/,
      );
      expect(() =>
        parseWorkerConfig({APP_ENV: environment, WINDY_API_KEY: ''}),
      ).toThrow(ConfigError);
    }
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
