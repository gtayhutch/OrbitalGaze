/**
 * @fileoverview Hook that loads the camera pins for the globe.
 *
 * Layer: client feature (browser only).
 */
import {useEffect, useState} from 'react';

import type {CameraIndexEntry} from '@/shared/cameras';

import {fetchCameraIndex} from './camera_api';

/** The index request's progress. */
export type CameraIndexState =
  | {readonly status: 'loading'}
  | {readonly status: 'ready'; readonly cameras: readonly CameraIndexEntry[]}
  | {readonly status: 'error'};

/**
 * Loads the camera index once when the component mounts.
 *
 * @returns The loading state, then either the cameras or an error. Errors are
 *     logged; the caller shows a message.
 * @example
 * const index = useCameraIndex();
 * if (index.status === 'ready') draw(index.cameras);
 */
export function useCameraIndex(): CameraIndexState {
  const [state, setState] = useState<CameraIndexState>({status: 'loading'});

  useEffect(() => {
    const controller = new AbortController();
    fetchCameraIndex(controller.signal)
      .then(index => {
        setState({status: 'ready', cameras: index.cameras});
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        console.error('Could not load the camera index.', error);
        setState({status: 'error'});
      });
    return () => {
      controller.abort();
    };
  }, []);

  return state;
}
