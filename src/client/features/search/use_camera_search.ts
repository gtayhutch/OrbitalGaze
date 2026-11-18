/**
 * @fileoverview Hook that searches cameras as the visitor types.
 *
 * Layer: client feature (browser only).
 *
 * Requests are debounced: the search runs only after the visitor pauses
 * typing for a moment, so typing "tokyo" sends one request, not five. Each new
 * query cancels the previous request, so a slow early answer can never
 * replace a newer one. Very short queries aren't sent at all.
 */
import {useEffect, useState} from 'react';

import {searchCameras} from '@/client/features/cameras';
import {ApiRequestError} from '@/client/lib/api_client';
import type {CameraSearchResult} from '@/shared/cameras';

/** Pause after the last keystroke before searching, in milliseconds. */
export const SEARCH_DEBOUNCE_MS = 250;

/** Shortest query that is sent, in characters (after trimming). */
export const MIN_SEARCH_LENGTH = 2;

/** The search's progress for the current query. */
export type CameraSearchState =
  | {readonly status: 'idle'}
  | {readonly status: 'loading'}
  | {
      readonly status: 'ready';
      readonly results: readonly CameraSearchResult[];
    }
  | {readonly status: 'rate-limited'}
  | {readonly status: 'error'};

/** A finished search, remembered with the query it answered. */
interface CompletedSearch {
  readonly query: string;
  readonly state: CameraSearchState;
}

/**
 * Searches for `query` after a short pause in typing.
 *
 * @param query The text in the search box.
 * @returns `idle` for short queries; otherwise loading, then ready, or
 *     rate-limited / error.
 * @example
 * const search = useCameraSearch(text);
 * if (search.status === 'ready') showResults(search.results);
 */
export function useCameraSearch(query: string): CameraSearchState {
  const trimmed = query.trim();
  const [completed, setCompleted] = useState<CompletedSearch | null>(null);

  useEffect(() => {
    if (trimmed.length < MIN_SEARCH_LENGTH) {
      return undefined;
    }
    const controller = new AbortController();
    // Step 1: wait for a pause in typing.
    const timer = window.setTimeout(() => {
      // Step 2: search, then record the outcome for this exact query.
      searchCameras(trimmed, controller.signal)
        .then(response => {
          setCompleted({
            query: trimmed,
            state: {status: 'ready', results: response.results},
          });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            return;
          }
          const rateLimited =
            error instanceof ApiRequestError && error.code === 'RATE_LIMITED';
          if (!rateLimited) {
            console.error('Camera search failed.', error);
          }
          setCompleted({
            query: trimmed,
            state: {status: rateLimited ? 'rate-limited' : 'error'},
          });
        });
    }, SEARCH_DEBOUNCE_MS);
    // Step 3: a new keystroke cancels the pending search or request.
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  if (trimmed.length < MIN_SEARCH_LENGTH) {
    return {status: 'idle'};
  }
  return completed?.query === trimmed ? completed.state : {status: 'loading'};
}
