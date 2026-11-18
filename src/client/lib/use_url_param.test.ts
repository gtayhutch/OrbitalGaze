/**
 * @fileoverview Tests for the URL query-parameter hook.
 *
 * Layer: client tests (jsdom).
 */
import {act, renderHook} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {useUrlParam} from './use_url_param';

describe('useUrlParam', () => {
  it('adds a history entry for each change by default', () => {
    const before = window.history.length;
    const {result} = renderHook(() => useUrlParam('camera'));

    act(() => {
      result.current[1]('cam-1');
    });

    expect(window.location.search).toBe('?camera=cam-1');
    expect(window.history.length).toBe(before + 1);
    expect(result.current[0]).toBe('cam-1');
  });

  it('rewrites the current entry when asked to replace', () => {
    const before = window.history.length;
    const {result} = renderHook(() => useUrlParam('view', {replace: true}));

    act(() => {
      result.current[1]('1_0_0_1000_0_-90');
    });

    expect(window.location.search).toBe('?view=1_0_0_1000_0_-90');
    expect(window.history.length).toBe(before);
  });

  it('removes the parameter when set to null', () => {
    window.history.replaceState(null, '', '/?camera=cam-1&view=x');
    const {result} = renderHook(() => useUrlParam('camera'));

    act(() => {
      result.current[1](null);
    });

    expect(window.location.search).toBe('?view=x');
  });
});
