/**
 * @fileoverview Tests for choosing still and moving render settings.
 *
 * Layer: client tests.
 */
import {describe, expect, it} from 'vitest';

import {renderSettingsFor} from './render_quality';

describe('renderSettingsFor', () => {
  it('draws still frames sharp, with MSAA and up to 2× pixels', () => {
    expect(renderSettingsFor(false, 3)).toEqual({
      msaaSamples: 4,
      fxaa: false,
      resolutionScale: 2,
    });
    expect(renderSettingsFor(false, 1.5).resolutionScale).toBe(1.5);
  });

  it('draws moving frames at CSS resolution with cheap smoothing', () => {
    expect(renderSettingsFor(true, 3)).toEqual({
      msaaSamples: 1,
      fxaa: true,
      resolutionScale: 1,
    });
  });

  it('treats a missing or odd pixel ratio as 1', () => {
    expect(renderSettingsFor(false, 0).resolutionScale).toBe(1);
    expect(renderSettingsFor(false, Number.NaN).resolutionScale).toBe(1);
  });
});
