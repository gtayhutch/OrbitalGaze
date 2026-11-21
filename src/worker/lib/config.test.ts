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
      ).toEqual({
        appEnvironment: environment,
        windyApiKey: 'key',
        basemapArchive: null,
        spaceTrack: null,
        satelliteRefreshOffsetMinutes: 25,
      });
    }
  });

  it('ignores bindings and other unknown keys', () => {
    expect(parseWorkerConfig({APP_ENV: 'test', DB: {}, OTHER: 1})).toEqual({
      appEnvironment: 'test',
      windyApiKey: null,
      basemapArchive: null,
      spaceTrack: null,
      satelliteRefreshOffsetMinutes: 25,
    });
  });

  it('reads the basemap archive key', () => {
    expect(
      parseWorkerConfig({
        APP_ENV: 'test',
        BASEMAP_ARCHIVE: 'planet/20261118.pmtiles',
      }).basemapArchive,
    ).toBe('planet/20261118.pmtiles');
  });

  it.each([
    ['../secrets.pmtiles'],
    ['planet/../other.pmtiles'],
    ['/planet/a.pmtiles'],
    ['planet/Map.pmtiles'],
    ['planet/map.zip'],
    [''],
  ])('rejects the unsafe archive key %j', key => {
    expect(() =>
      parseWorkerConfig({APP_ENV: 'test', BASEMAP_ARCHIVE: key}),
    ).toThrow(/BASEMAP_ARCHIVE/);
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

  it('reads the Space-Track login when both parts are set', () => {
    const config = parseWorkerConfig({
      APP_ENV: 'test',
      SPACETRACK_IDENTITY: 'me@example.test',
      SPACETRACK_PASSWORD: 'pw',
    });

    expect(config.spaceTrack).toEqual({
      identity: 'me@example.test',
      password: 'pw',
    });
  });

  it('treats empty Space-Track values as not set', () => {
    expect(
      parseWorkerConfig({
        APP_ENV: 'staging',
        WINDY_API_KEY: 'key',
        SPACETRACK_IDENTITY: '',
        SPACETRACK_PASSWORD: '',
      }).spaceTrack,
    ).toBeNull();
  });

  it('refuses half a Space-Track login, naming the setting only', () => {
    expect(() =>
      parseWorkerConfig({
        APP_ENV: 'test',
        SPACETRACK_IDENTITY: 'me@example.test',
      }),
    ).toThrow(/SPACETRACK_PASSWORD/);
    expect(() =>
      parseWorkerConfig({
        APP_ENV: 'test',
        SPACETRACK_IDENTITY: 'me@example.test',
      }),
    ).not.toThrow(/me@example\.test/);
  });

  it('reads the satellites offset, defaulting to 25 minutes', () => {
    expect(
      parseWorkerConfig({
        APP_ENV: 'test',
        SATELLITE_REFRESH_OFFSET_MINUTES: '205',
      }).satelliteRefreshOffsetMinutes,
    ).toBe(205);
    expect(
      parseWorkerConfig({APP_ENV: 'test'}).satelliteRefreshOffsetMinutes,
    ).toBe(25);
  });

  it.each(['27', '360', '-5', 'soon'])(
    'refuses the satellites offset %s',
    value => {
      expect(() =>
        parseWorkerConfig({
          APP_ENV: 'test',
          SATELLITE_REFRESH_OFFSET_MINUTES: value,
        }),
      ).toThrow(/SATELLITE_REFRESH_OFFSET_MINUTES/);
    },
  );
});
