/**
 * @fileoverview Tests for writing and reading share-link text.
 *
 * Layer: client tests.
 */
import {describe, expect, it} from 'vitest';

import {decodeLayers, decodeView, encodeLayers, encodeView} from './view_codec';

const TOKYO = {
  lng: 139.7454,
  lat: 35.6586,
  height: 40_000,
  heading: 12.5,
  pitch: -60,
};

describe('encodeView and decodeView', () => {
  it('round-trips a view', () => {
    const text = encodeView(TOKYO);

    expect(text).toBe('1_139.7454_35.6586_40000_12.5_-60.0');
    expect(decodeView(text)).toEqual(TOKYO);
  });

  it('keeps headings within 0–360', () => {
    expect(encodeView({...TOKYO, heading: -10})).toContain('_350.0_');
    expect(encodeView({...TOKYO, heading: 370})).toContain('_10.0_');
  });

  it.each([
    ['an absent value', null],
    ['an unknown format version', '2_139.7_35.6_40000_0_-90'],
    ['too few fields', '1_139.7_35.6_40000_0'],
    ['an empty field', '1_139.7__40000_0_-90'],
    ['text instead of a number', '1_east_35.6_40000_0_-90'],
    ['a longitude out of range', '1_200_35.6_40000_0_-90'],
    ['a latitude out of range', '1_139.7_95_40000_0_-90'],
    ['a height of zero', '1_139.7_35.6_0_0_-90'],
    ['an absurd height', '1_139.7_35.6_900000000_0_-90'],
    ['script text', '1_<script>_35.6_40000_0_-90'],
  ])('rejects %s', (_label, value) => {
    expect(decodeView(value)).toBeNull();
  });
});

describe('encodeLayers and decodeLayers', () => {
  it('round-trips the active layers', () => {
    expect(decodeLayers(encodeLayers(new Set(['webcams'] as const)))).toEqual(
      new Set(['webcams']),
    );
  });

  it('drops unknown layers and treats an empty value as no layers', () => {
    expect(decodeLayers('webcams, volcanoes')).toEqual(new Set(['webcams']));
    expect(decodeLayers('')).toEqual(new Set());
  });

  it('returns null when the parameter is absent', () => {
    expect(decodeLayers(null)).toBeNull();
  });
});
