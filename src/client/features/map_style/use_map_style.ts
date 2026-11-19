/**
 * @fileoverview Which map style the globe shows: the dark map or satellite imagery.
 *
 * Layer: client feature (browser only). Used by the app shell; the globe
 * only receives the chosen style.
 *
 * The choice is a visitor preference, remembered in `localStorage`, and it
 * also lives in the URL (`?map=satellite`) so a shared link opens in the
 * same style. A link's value wins for that visit; switching style updates
 * both. The dark map is the default, so `?map=` is left out for it.
 */
import {useCallback} from 'react';

import {useUrlParam} from '@/client/lib/use_url_param';

/** The map styles the globe can show. */
export type MapStyle = 'dark' | 'satellite';

/** URL query parameter holding the style (only written for satellite). */
export const MAP_STYLE_URL_PARAM = 'map';

/** `localStorage` key for the remembered style. */
export const MAP_STYLE_STORAGE_KEY = 'orbitalgaze.mapStyle';

/** Reads a style from text, or `null` if it isn't one. */
function asMapStyle(value: string | null): MapStyle | null {
  return value === 'dark' || value === 'satellite' ? value : null;
}

/** The remembered style, or `null` (storage blocked or nothing saved). */
function readSavedStyle(): MapStyle | null {
  try {
    return asMapStyle(window.localStorage.getItem(MAP_STYLE_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Remembers the style; failures are ignored (it's only a preference). */
function saveStyle(style: MapStyle): void {
  try {
    window.localStorage.setItem(MAP_STYLE_STORAGE_KEY, style);
  } catch {
    // Storage blocked: the choice lasts while the URL keeps it.
  }
}

/** The current style and how to change it. */
export interface MapStyleState {
  readonly style: MapStyle;
  readonly setStyle: (style: MapStyle) => void;
}

/**
 * The globe's map style: from the URL, else the visitor's saved choice,
 * else the dark map.
 *
 * @returns The style and a setter that updates the URL and the saved choice.
 * @example
 * const {style, setStyle} = useMapStyle();
 */
export function useMapStyle(): MapStyleState {
  const [rawStyle, setStyleParam] = useUrlParam(MAP_STYLE_URL_PARAM, {
    replace: true,
  });
  const style = asMapStyle(rawStyle) ?? readSavedStyle() ?? 'dark';

  const setStyle = useCallback(
    (next: MapStyle) => {
      saveStyle(next);
      setStyleParam(next === 'satellite' ? 'satellite' : null);
    },
    [setStyleParam],
  );
  return {style, setStyle};
}
