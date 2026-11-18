/**
 * @fileoverview Unit tests for browser configuration parsing.
 *
 * Layer: client tests.
 */
import {describe, expect, it} from 'vitest';

import {parseClientConfig} from './config';

describe('parseClientConfig', () => {
  it('reads the Cesium ion token when set', () => {
    expect(parseClientConfig({VITE_CESIUM_ION_TOKEN: 'public-token'})).toEqual({
      cesiumIonToken: 'public-token',
    });
  });

  it('treats a missing or empty token as unset', () => {
    expect(parseClientConfig({}).cesiumIonToken).toBeUndefined();
    expect(
      parseClientConfig({VITE_CESIUM_ION_TOKEN: ''}).cesiumIonToken,
    ).toBeUndefined();
  });

  it('rejects a token of the wrong type', () => {
    expect(() => parseClientConfig({VITE_CESIUM_ION_TOKEN: 42})).toThrow();
  });
});
