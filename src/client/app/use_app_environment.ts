/**
 * @fileoverview Hook that asks the API which environment is serving the app.
 *
 * Layer: client app shell (browser only). Used by the environment badge.
 *
 * The environment comes from the Worker's health endpoint rather than from
 * build settings, so the badge always reflects the server that actually
 * answered.
 */
import {useEffect, useState} from 'react';

import {fetchHealth} from '@/client/lib/api_client';
import type {AppEnvironment} from '@/shared/app_environment';

/**
 * Returns the environment reported by the API.
 *
 * @returns The environment name, or `undefined` while loading or if the
 *     request failed. A failure is logged and otherwise ignored: the badge is
 *     a convenience, and the rest of the app works without it.
 * @example
 * const environment = useAppEnvironment();
 */
export function useAppEnvironment(): AppEnvironment | undefined {
  const [environment, setEnvironment] = useState<AppEnvironment>();

  useEffect(() => {
    // Abort the request if the component unmounts before it finishes.
    const controller = new AbortController();
    fetchHealth(controller.signal)
      .then(health => {
        setEnvironment(health.environment);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.warn('Could not read the app environment.', error);
        }
      });
    return () => {
      controller.abort();
    };
  }, []);

  return environment;
}
