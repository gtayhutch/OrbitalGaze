/**
 * @fileoverview Tests for writing and reading share-link text.
 *
 * Layer: client tests.
 */
import {describe, expect, it} from 'vitest';

import {
  decodeLayers,
  decodeView,
  encodeLayers,
  encodeView,
  zoomForHeight,
} from './view_codec';

const TOKYO = {
  lng: 139.7454,
  lat: 35.6586,
  zoom: 11,
  bearing: 12.5,
  pitch: 30,
};

describe('encodeView and decodeView', () => {
  it('round-trips a view', () => {
    const text = encodeView(TOKYO);

    expect(text).toBe('2_139.7454_35.6586_11.00_12.5_30.0');
    expect(decodeView(text)).toEqual(TOKYO);
  });

  it('keeps bearings within 0–360', () => {
    expect(encodeView({...TOKYO, bearing: -10})).toContain('_350.0_');
    expect(encodeView({...TOKYO, bearing: 370})).toContain('_10.0_');
  });

  it('clamps zoom and pitch into the link format', () => {
    expect(encodeView({...TOKYO, zoom: -0.3, pitch: 90})).toBe(
      '2_139.7454_35.6586_0.00_12.5_85.0',
    );
  });

  it.each([
    ['an absent value', null],
    ['an unknown format version', '3_139.7_35.6_11_0_0'],
    ['too few fields', '2_139.7_35.6_11_0'],
    ['an empty field', '2_139.7__11_0_0'],
    ['text instead of a number', '2_east_35.6_11_0_0'],
    ['a longitude out of range', '2_200_35.6_11_0_0'],
    ['a latitude out of range', '2_139.7_95_11_0_0'],
    ['a negative zoom', '2_139.7_35.6_-1_0_0'],
    ['an absurd zoom', '2_139.7_35.6_99_0_0'],
    ['a pitch past the horizon', '2_139.7_35.6_11_0_90'],
    ['script text', '2_<script>_35.6_11_0_0'],
  ])('rejects %s', (_label, value) => {
    expect(decodeView(value)).toBeNull();
  });
});

describe('decodeView with links from the earlier globe (version 1)', () => {
  it('turns height into zoom and the old pitch into the new one', () => {
    const view = decodeView('1_139.7454_35.6586_40000_12.5_-90.0');

    expect(view).not.toBeNull();
    expect(view?.lng).toBe(139.7454);
    expect(view?.lat).toBe(35.6586);
    expect(view?.zoom).toBeCloseTo(11.2, 1);
    expect(view?.bearing).toBe(12.5);
    // −90 looked straight down; 0 does now.
    expect(view?.pitch).toBe(0);
  });

  it('caps a near-horizon pitch at the new maximum', () => {
    expect(decodeView('1_0_0_40000_0_0')?.pitch).toBe(85);
    expect(decodeView('1_0_0_40000_0_-60')?.pitch).toBe(30);
  });

  it.each([
    ['a height of zero', '1_139.7_35.6_0_0_-90'],
    ['an absurd height', '1_139.7_35.6_900000000_0_-90'],
    ['a pitch out of range', '1_139.7_35.6_40000_0_-120'],
  ])('rejects %s', (_label, value) => {
    expect(decodeView(value)).toBeNull();
  });
});

describe('zoomForHeight', () => {
  it('maps city, region and whole-Earth heights to matching zooms', () => {
    expect(zoomForHeight(40_000)).toBeCloseTo(11.2, 1);
    expect(zoomForHeight(2_000_000)).toBeCloseTo(5.55, 1);
    expect(zoomForHeight(20_000_000)).toBeCloseTo(2.23, 1);
  });

  it('stays within the zoom range for extreme heights', () => {
    expect(zoomForHeight(1)).toBe(24);
    expect(zoomForHeight(50_000_000)).toBeGreaterThanOrEqual(0);
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
