/**
 * @fileoverview Hook that loads one camera's details for the detail panel.
 *
 * Layer: client feature (browser only).
 */
import {useEffect, useState} from 'react';

import {ApiRequestError} from '@/client/lib/api_client';
import type {CameraDetail} from '@/shared/cameras';

import {fetchCamera} from './camera_api';

/** The detail request's progress for the selected camera. */
export type CameraDetailState =
  | {readonly status: 'idle'}
  | {readonly status: 'loading'; readonly id: string}
  | {readonly status: 'ready'; readonly camera: CameraDetail}
  | {readonly status: 'not-found'; readonly id: string}
  | {readonly status: 'error'; readonly id: string};

/**
 * Loads details whenever `cameraId` changes; cancels the previous request.
 *
 * @param cameraId The selected camera, or `null` when nothing is selected.
 * @returns `idle` with no selection; otherwise loading, then ready,
 *     not-found (unknown or not public), or error.
 * @example
 * const detail = useCameraDetail(selectedId);
 */
export function useCameraDetail(cameraId: string | null): CameraDetailState {
  // The loaded result, remembered with the ID it belongs to, so a stale
  // result is never shown for a newly selected camera.
  const [result, setResult] = useState<CameraDetailState>({status: 'idle'});

  useEffect(() => {
    if (cameraId === null) {
      return undefined;
    }
    const controller = new AbortController();
    fetchCamera(cameraId, controller.signal)
      .then(camera => {
        setResult({status: 'ready', camera});
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        if (error instanceof ApiRequestError && error.code === 'NOT_FOUND') {
          setResult({status: 'not-found', id: cameraId});
          return;
        }
        console.error('Could not load the camera.', error);
        setResult({status: 'error', id: cameraId});
      });
    return () => {
      controller.abort();
    };
  }, [cameraId]);

  // Derive what to show from the selection and the last result.
  if (cameraId === null) {
    return {status: 'idle'};
  }
  const resultId = result.status === 'ready' ? result.camera.id : null;
  const failedId =
    result.status === 'not-found' || result.status === 'error'
      ? result.id
      : null;
  if (resultId === cameraId || failedId === cameraId) {
    return result;
  }
  return {status: 'loading', id: cameraId};
}
