/**
 * @fileoverview Hook that loads a camera's current image and player links.
 *
 * Layer: client feature (browser only).
 *
 * The provider's links expire (Windy's after 10 minutes), so the hook asks
 * again when the current links reach `expiresAt`, and whenever the caller
 * asks to retry (for example after the image failed to load).
 */
import {useCallback, useEffect, useState} from 'react';

import {ApiRequestError} from '@/client/lib/api_client';
import type {CameraFeed} from '@/shared/cameras';

import {fetchCameraFeed} from './camera_api';

/** The feed request's progress for one camera. */
export type CameraFeedState =
  | {readonly status: 'idle'}
  | {readonly status: 'loading'}
  | {readonly status: 'ready'; readonly feed: CameraFeed}
  | {readonly status: 'unavailable'}
  | {readonly status: 'error'};

/** What {@link useCameraFeed} returns. */
export interface CameraFeedResult {
  /** The current state for the requested camera. */
  readonly state: CameraFeedState;
  /** Asks for fresh links now. */
  readonly retry: () => void;
}

/** A loaded result, remembered with the request it answers. */
interface StoredResult {
  readonly key: string;
  readonly state: CameraFeedState;
}

/** Shortest wait before refreshing expired links, in milliseconds. */
const MIN_REFRESH_DELAY_MS = 5_000;

/**
 * Loads the feed for `cameraId`, or does nothing when it is `null` (no
 * camera selected, or the camera has no feed).
 *
 * @param cameraId The camera to load, or `null`.
 * @returns The state, and a function to fetch fresh links.
 * @example
 * const {state, retry} = useCameraFeed(camera.hasFeed ? camera.id : null);
 */
export function useCameraFeed(cameraId: string | null): CameraFeedResult {
  // Bumped to fetch again for the same camera (expiry or retry).
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<StoredResult | null>(null);
  const requestKey = cameraId === null ? null : `${cameraId}#${attempt}`;

  const retry = useCallback(() => {
    setAttempt(previous => previous + 1);
  }, []);

  // Step 1: fetch whenever the camera or attempt changes; cancel the last one.
  useEffect(() => {
    if (cameraId === null || requestKey === null) {
      return undefined;
    }
    const controller = new AbortController();
    fetchCameraFeed(cameraId, controller.signal)
      .then(feed => {
        setResult({key: requestKey, state: {status: 'ready', feed}});
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        if (error instanceof ApiRequestError && error.code === 'NOT_FOUND') {
          setResult({key: requestKey, state: {status: 'unavailable'}});
          return;
        }
        console.error('Could not load the camera preview.', error);
        setResult({key: requestKey, state: {status: 'error'}});
      });
    return () => {
      controller.abort();
    };
  }, [cameraId, requestKey]);

  // Step 2: when links are loaded, schedule a refresh for when they expire.
  const readyFeed =
    result?.key === requestKey && result.state.status === 'ready'
      ? result.state.feed
      : null;
  useEffect(() => {
    if (readyFeed === null) {
      return undefined;
    }
    const delay = Math.max(
      Date.parse(readyFeed.expiresAt) - Date.now(),
      MIN_REFRESH_DELAY_MS,
    );
    const timer = window.setTimeout(retry, delay);
    return () => {
      window.clearTimeout(timer);
    };
  }, [readyFeed, retry]);

  // Step 3: derive the state for this request. While refreshing, keep
  // showing the previous links for the same camera instead of flashing a
  // loading state.
  if (cameraId === null) {
    return {state: {status: 'idle'}, retry};
  }
  if (result?.key === requestKey) {
    return {state: result.state, retry};
  }
  if (
    result?.state.status === 'ready' &&
    result.key.startsWith(`${cameraId}#`)
  ) {
    return {state: result.state, retry};
  }
  return {state: {status: 'loading'}, retry};
}
