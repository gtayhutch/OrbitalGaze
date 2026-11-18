/**
 * @fileoverview Hook for which layers are switched on.
 *
 * Layer: client feature (browser only).
 *
 * The visitor's choices are a UI preference, remembered in `localStorage` on
 * this device. Only explicit choices are saved, as `{layerId: on}`. A layer
 * with no saved choice uses its registry default. That way a layer added
 * after someone's last visit still appears for them if it's on by default.
 *
 * Storage can be unavailable (private browsing, blocked cookies) or hold
 * stale values (layers that no longer exist); both fall back to the
 * defaults.
 */
import {useCallback, useMemo, useState} from 'react';

import type {LayerDefinition} from './layer_definition';
import {isLayerId, LAYER_DEFINITIONS, type LayerId} from './registry';

/** `localStorage` key for the visitor's layer choices. */
export const LAYER_CHOICES_STORAGE_KEY = 'orbitalgaze.layerChoices';

/** Explicit on/off choices; layers not listed use their default. */
type LayerChoices = Readonly<Partial<Record<LayerId, boolean>>>;

/** Reads the saved choices, keeping only valid entries for known layers. */
function readChoices(): LayerChoices {
  try {
    const saved: unknown = JSON.parse(
      window.localStorage.getItem(LAYER_CHOICES_STORAGE_KEY) ?? '{}',
    );
    if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) {
      return {};
    }
    const choices: Partial<Record<LayerId, boolean>> = {};
    for (const [key, value] of Object.entries(saved)) {
      if (isLayerId(key) && typeof value === 'boolean') {
        choices[key] = value;
      }
    }
    return choices;
  } catch {
    // Storage blocked or corrupt: use the defaults.
    return {};
  }
}

/** Saves the choices; failures are ignored (it's only a preference). */
function writeChoices(choices: LayerChoices): void {
  try {
    window.localStorage.setItem(
      LAYER_CHOICES_STORAGE_KEY,
      JSON.stringify(choices),
    );
  } catch {
    // Storage blocked: the choice lasts until the page is closed.
  }
}

/** Which layers are on, and how to change that. */
export interface ActiveLayers {
  /** The layers that are on. */
  readonly active: ReadonlySet<LayerId>;
  /**
   * Switches one layer on or off and remembers the choice. Stable across
   * renders, so it can be passed around and used in effect dependencies.
   */
  readonly setLayerActive: (layerId: LayerId, active: boolean) => void;
}

/** Whether a layer is on, given the saved choices. */
function isOn(choices: LayerChoices, layerId: LayerId): boolean {
  const layer = (LAYER_DEFINITIONS as readonly LayerDefinition[]).find(
    candidate => candidate.id === layerId,
  );
  return choices[layerId] ?? layer?.defaultOn ?? false;
}

/**
 * Tracks which layers are switched on, remembering choices on this device.
 *
 * @returns The active set and a setter. The set changes identity only when
 *     a choice changes, so components can depend on it.
 * @example
 * const layers = useActiveLayers();
 * const showWebcams = layers.active.has('webcams');
 */
export function useActiveLayers(): ActiveLayers {
  const [choices, setChoices] = useState<LayerChoices>(readChoices);

  const setLayerActive = useCallback((layerId: LayerId, active: boolean) => {
    setChoices(previous => {
      // Nothing changes when the layer is already in that state, so the
      // active set keeps its identity and nothing redraws.
      if (isOn(previous, layerId) === active) {
        return previous;
      }
      const next = {...previous, [layerId]: active};
      writeChoices(next);
      return next;
    });
  }, []);

  const active = useMemo(
    () =>
      new Set(
        LAYER_DEFINITIONS.filter(layer => isOn(choices, layer.id)).map(
          layer => layer.id,
        ),
      ),
    [choices],
  );
  return {active, setLayerActive};
}
