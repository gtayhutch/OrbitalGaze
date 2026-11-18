/**
 * @fileoverview Tests for the active-layers hook.
 *
 * Layer: client tests (jsdom).
 */
import {act, renderHook} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {LAYER_CHOICES_STORAGE_KEY, useActiveLayers} from './use_active_layers';

describe('useActiveLayers', () => {
  it('starts with the layers that are on by default', () => {
    const {result} = renderHook(() => useActiveLayers());

    expect([...result.current.active]).toEqual(['webcams']);
  });

  it('switches a layer off and remembers the choice on this device', () => {
    const {result} = renderHook(() => useActiveLayers());

    act(() => {
      result.current.setLayerActive('webcams', false);
    });

    expect(result.current.active.has('webcams')).toBe(false);
    expect(window.localStorage.getItem(LAYER_CHOICES_STORAGE_KEY)).toBe(
      '{"webcams":false}',
    );
  });

  it('restores saved choices and ignores unknown layers and bad values', () => {
    window.localStorage.setItem(
      LAYER_CHOICES_STORAGE_KEY,
      '{"webcams": false, "volcanoes": true, "other": "yes"}',
    );

    const {result} = renderHook(() => useActiveLayers());

    expect(result.current.active.size).toBe(0);
  });

  it('falls back to the defaults when the saved value is corrupt', () => {
    window.localStorage.setItem(LAYER_CHOICES_STORAGE_KEY, '[not json');

    const {result} = renderHook(() => useActiveLayers());

    expect(result.current.active.has('webcams')).toBe(true);
  });

  it('keeps the same set when a choice is repeated', () => {
    const {result} = renderHook(() => useActiveLayers());
    const before = result.current.active;

    act(() => {
      result.current.setLayerActive('webcams', true);
    });

    expect(result.current.active).toBe(before);
  });
});
