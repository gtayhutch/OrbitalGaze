/**
 * @fileoverview Tests for the layer registry.
 *
 * Layer: client tests.
 *
 * These guard the rules every registered layer must follow, so a new layer
 * that breaks one fails here instead of in the panel or credit bar.
 */
import {describe, expect, it} from 'vitest';

import type {LayerDefinition} from './layer_definition';
import {
  ALL_LAYER_DEFINITIONS,
  groupLayersByDomain,
  isLayerId,
  LAYER_DEFINITIONS,
  LAYER_IDS,
} from './registry';

/** Builds a layer definition for grouping tests. */
function buildLayer(overrides: Partial<LayerDefinition>): LayerDefinition {
  return {
    id: 'test-layer',
    domain: 'earth',
    label: 'Test layer',
    summary: 'A layer used in tests.',
    attribution: [],
    defaultOn: false,
    ...overrides,
  };
}

describe('LAYER_DEFINITIONS', () => {
  it('gives every layer a unique ID', () => {
    expect(new Set(LAYER_IDS).size).toBe(LAYER_DEFINITIONS.length);
  });

  it('credits every layer, linking only to https addresses', () => {
    for (const layer of LAYER_DEFINITIONS as readonly LayerDefinition[]) {
      expect(layer.attribution.length).toBeGreaterThan(0);
      for (const part of layer.attribution) {
        if (part.href !== undefined) {
          expect(new URL(part.href).protocol).toBe('https:');
        }
      }
    }
  });

  it('credits Windy exactly as its terms ask', () => {
    const webcams = (LAYER_DEFINITIONS as readonly LayerDefinition[]).find(
      layer => layer.id === 'webcams',
    );

    expect(webcams?.attribution.map(part => part.text).join('')).toBe(
      'Webcams provided by windy.com — add a webcam',
    );
  });
});

describe('isLayerId', () => {
  it('accepts registered IDs and rejects anything else', () => {
    expect(isLayerId('webcams')).toBe(true);
    expect(isLayerId('volcanoes')).toBe(false);
    expect(isLayerId(42)).toBe(false);
  });
});

describe('groupLayersByDomain', () => {
  it('groups layers in panel order and leaves out empty groups', () => {
    const groups = groupLayersByDomain([
      buildLayer({id: 'quakes', domain: 'earth'}),
      buildLayer({id: 'cams', domain: 'cameras'}),
      buildLayer({id: 'events', domain: 'earth'}),
    ]);

    expect(groups.map(group => group.label)).toEqual(['Cameras', 'Earth']);
    expect(groups[1]?.layers.map(layer => layer.id)).toEqual([
      'quakes',
      'events',
    ]);
  });
});

describe('unreleased layers', () => {
  it('keeps a built but unreleased layer out of the app', () => {
    const satellites = ALL_LAYER_DEFINITIONS.find(
      layer => layer.id === 'satellites',
    );

    // Built and registered, but paused until its data can be fetched.
    expect(satellites).toBeDefined();
    expect(LAYER_DEFINITIONS.map(layer => layer.id)).not.toContain(
      'satellites',
    );
    expect(LAYER_IDS).not.toContain('satellites');
    expect(isLayerId('satellites')).toBe(false);
    expect(groupLayersByDomain().some(group => group.domain === 'space')).toBe(
      false,
    );
  });
});
