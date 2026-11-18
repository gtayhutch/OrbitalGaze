/**
 * @fileoverview Hook that keeps one URL query parameter in React state.
 *
 * Layer: client library (browser only).
 *
 * Pattern: Observer. The URL is the source of truth for shareable state (for
 * example `?camera=seed-0042`), so links and the Back button work. The hook
 * subscribes to `popstate`, which fires on Back/Forward, and writes changes
 * with `history.pushState`, so each change is one history entry.
 *
 * State that changes constantly and shouldn't fill the Back button's history
 * (for example the globe's view, updated after every pan) passes
 * `{replace: true}`, so the current entry is rewritten instead.
 */
import {useCallback, useEffect, useState} from 'react';

/** Options for {@link useUrlParam}. */
export interface UrlParamOptions {
  /** Rewrite the current history entry instead of adding a new one. */
  readonly replace?: boolean;
}

/** Reads `name` from the current URL. */
function readParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

/**
 * Reads and writes one query parameter.
 *
 * @param name The parameter name, for example `camera`.
 * @param options `{replace: true}` to update the URL without adding history.
 * @returns The current value (or `null` when absent) and a setter. Setting
 *     `null` removes the parameter.
 * @example
 * const [cameraId, setCameraId] = useUrlParam('camera');
 * setCameraId('seed-0042'); // URL becomes ?camera=seed-0042
 */
export function useUrlParam(
  name: string,
  options: UrlParamOptions = {},
): [string | null, (value: string | null) => void] {
  const replace = options.replace === true;
  const [value, setValue] = useState(() => readParam(name));

  // Follow Back and Forward.
  useEffect(() => {
    const syncFromUrl = (): void => {
      setValue(readParam(name));
    };
    window.addEventListener('popstate', syncFromUrl);
    return () => {
      window.removeEventListener('popstate', syncFromUrl);
    };
  }, [name]);

  const update = useCallback(
    (next: string | null) => {
      const url = new URL(window.location.href);
      if (next === null) {
        url.searchParams.delete(name);
      } else {
        url.searchParams.set(name, next);
      }
      // Only touch history when the URL actually changes.
      if (url.href !== window.location.href) {
        if (replace) {
          window.history.replaceState(null, '', url);
        } else {
          window.history.pushState(null, '', url);
        }
      }
      setValue(next);
    },
    [name, replace],
  );

  return [value, update];
}
