/**
 * @fileoverview Hook for which satellite groups are shown on the globe.
 *
 * Layer: client feature (browser only).
 *
 * Like the camera category filter, the choice is a UI preference kept in
 * `localStorage` on this device. Blocked storage or stale values fall back
 * to showing every group.
 */
import {useCallback, useMemo, useState} from 'react';

import {
  SATELLITE_GROUPS,
  SatelliteGroupSchema,
  type SatelliteGroup,
} from '@/shared/satellites';

/** `localStorage` key for the hidden groups. */
export const HIDDEN_SATELLITE_GROUPS_STORAGE_KEY =
  'orbitalgaze.hiddenSatelliteGroups';

/** Reads the saved hidden groups, ignoring anything unrecognised. */
function readHiddenGroups(): Set<SatelliteGroup> {
  try {
    const saved: unknown = JSON.parse(
      window.localStorage.getItem(HIDDEN_SATELLITE_GROUPS_STORAGE_KEY) ?? '[]',
    );
    return new Set(
      Array.isArray(saved)
        ? saved.filter(
            (value): value is SatelliteGroup =>
              SatelliteGroupSchema.safeParse(value).success,
          )
        : [],
    );
  } catch {
    // Storage blocked or corrupt: show everything.
    return new Set();
  }
}

/** Saves the hidden groups; failures are ignored (it's only a preference). */
function writeHiddenGroups(hidden: ReadonlySet<SatelliteGroup>): void {
  try {
    window.localStorage.setItem(
      HIDDEN_SATELLITE_GROUPS_STORAGE_KEY,
      JSON.stringify([...hidden]),
    );
  } catch {
    // Storage blocked: the choice lasts until the page is closed.
  }
}

/** The filter's current value and how to change it. */
export interface SatelliteGroupFilter {
  /** Groups currently shown. */
  readonly visible: ReadonlySet<SatelliteGroup>;
  /** Shows or hides one group. */
  setGroupVisible(group: SatelliteGroup, visible: boolean): void;
}

/**
 * Tracks which satellite groups are visible, remembered on this device.
 *
 * @returns The visible set and a setter.
 * @example
 * const groups = useSatelliteGroups();
 * groups.setGroupVisible('starlink', false);
 */
export function useSatelliteGroups(): SatelliteGroupFilter {
  const [hidden, setHidden] =
    useState<ReadonlySet<SatelliteGroup>>(readHiddenGroups);

  const setGroupVisible = useCallback(
    (group: SatelliteGroup, visible: boolean) => {
      setHidden(previous => {
        const next = new Set(previous);
        if (visible) {
          next.delete(group);
        } else {
          next.add(group);
        }
        writeHiddenGroups(next);
        return next;
      });
    },
    [],
  );

  // A new set only when the choice changes.
  const visible = useMemo(
    () => new Set(SATELLITE_GROUPS.filter(group => !hidden.has(group))),
    [hidden],
  );
  return useMemo(
    () => ({visible, setGroupVisible}),
    [visible, setGroupVisible],
  );
}
