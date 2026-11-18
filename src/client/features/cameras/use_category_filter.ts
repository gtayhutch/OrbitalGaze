/**
 * @fileoverview Hook for which camera categories are shown on the globe.
 *
 * Layer: client feature (browser only).
 *
 * The choice is a UI preference, so it is remembered in `localStorage` on
 * this device. Storage can be unavailable (private browsing, blocked
 * cookies) or hold stale values; both fall back to showing every category.
 */
import {useCallback, useMemo, useState} from 'react';

import {
  CAMERA_CATEGORIES,
  CameraCategorySchema,
  type CameraCategory,
} from '@/shared/cameras';

/** `localStorage` key for the hidden categories. */
export const HIDDEN_CATEGORIES_STORAGE_KEY = 'orbitalgaze.hiddenCategories';

/** Reads the saved hidden categories, ignoring anything unrecognized. */
function readHiddenCategories(): Set<CameraCategory> {
  try {
    const saved: unknown = JSON.parse(
      window.localStorage.getItem(HIDDEN_CATEGORIES_STORAGE_KEY) ?? '[]',
    );
    const valid = Array.isArray(saved)
      ? saved.filter(
          (value): value is CameraCategory =>
            CameraCategorySchema.safeParse(value).success,
        )
      : [];
    return new Set(valid);
  } catch {
    // Storage blocked or corrupt: show everything.
    return new Set();
  }
}

/** Saves the hidden categories; failures are ignored (it's only a preference). */
function writeHiddenCategories(hidden: ReadonlySet<CameraCategory>): void {
  try {
    window.localStorage.setItem(
      HIDDEN_CATEGORIES_STORAGE_KEY,
      JSON.stringify([...hidden]),
    );
  } catch {
    // Storage blocked: the choice lasts until the page is closed.
  }
}

/** The filter's current value and how to change it. */
export interface CategoryFilter {
  /** Categories currently shown on the globe. */
  readonly visible: ReadonlySet<CameraCategory>;
  /** Shows or hides one category. */
  setCategoryVisible(category: CameraCategory, visible: boolean): void;
}

/**
 * Tracks which categories are visible, remembering the choice on this device.
 *
 * @returns The visible set and a setter.
 * @example
 * const {visible, setCategoryVisible} = useCategoryFilter();
 */
export function useCategoryFilter(): CategoryFilter {
  const [hidden, setHidden] =
    useState<ReadonlySet<CameraCategory>>(readHiddenCategories);

  const setCategoryVisible = useCallback(
    (category: CameraCategory, visible: boolean) => {
      setHidden(previous => {
        const next = new Set(previous);
        if (visible) {
          next.delete(category);
        } else {
          next.add(category);
        }
        writeHiddenCategories(next);
        return next;
      });
    },
    [],
  );

  // A new set only when the choice changes, so the globe re-filters its pins
  // only then.
  const visible = useMemo(
    () => new Set(CAMERA_CATEGORIES.filter(category => !hidden.has(category))),
    [hidden],
  );
  return {visible, setCategoryVisible};
}
