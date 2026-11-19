/**
 * @fileoverview The satellites layer's section in the layer panel.
 *
 * Layer: client feature (browser only). Rendered by the app shell inside the
 * layer panel while the satellites layer is on.
 *
 * Shows how many satellites are drawn, how fresh the orbit data is, and one
 * checkbox per group (with its colour and count). The dots on the globe
 * can't be reached by keyboard, so the panel also says that search finds any
 * satellite by name or catalogue number.
 */
import {useId} from 'react';

import {Checkbox} from '@/client/components/ui/checkbox';
import {FreshnessChip} from '@/client/features/layers';
import {SATELLITE_GROUPS} from '@/shared/satellites';

import {SATELLITE_GROUP_STYLES} from './satellite_groups';
import type {SatelliteGroupFilter} from './use_satellite_groups';
import type {SatellitesState} from './use_satellites';

/** Orbit data older than this is marked stale (the server refreshes every 6 h). */
const STALE_AFTER_MS = 18 * 60 * 60_000;

/** Props for {@link SatelliteControls}. */
export interface SatelliteControlsProps {
  readonly state: SatellitesState;
  readonly filter: SatelliteGroupFilter;
}

/**
 * The satellites layer's controls: count, freshness, and group filters.
 *
 * @example
 * <SatelliteControls state={satellites.state} filter={groups} />
 */
export function SatelliteControls({
  state,
  filter,
}: SatelliteControlsProps): React.JSX.Element {
  const baseId = useId();
  if (state.status !== 'ready') {
    return <SatelliteStatus status={state.status} />;
  }

  const shown = SATELLITE_GROUPS.filter(group => filter.visible.has(group))
    .map(group => state.counts[group])
    .reduce((total, count) => total + count, 0);
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-xs text-muted-foreground tabular-nums">
          {shown.toLocaleString()} shown
        </span>
        <FreshnessChip
          asOf={new Date(state.catalog.checkedAt)}
          staleAfterMs={STALE_AFTER_MS}
          prefix="Orbits updated"
        />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Search finds any satellite by name or number.
      </p>
      <fieldset className="mt-3 space-y-2">
        <legend className="sr-only">Satellite groups</legend>
        {SATELLITE_GROUPS.map(group => {
          const checkboxId = `${baseId}-${group}`;
          const style = SATELLITE_GROUP_STYLES[group];
          return (
            <div key={group} className="flex items-center gap-3">
              <Checkbox
                id={checkboxId}
                checked={filter.visible.has(group)}
                onCheckedChange={checked => {
                  filter.setGroupVisible(group, checked === true);
                }}
              />
              <label
                htmlFor={checkboxId}
                className="flex flex-1 cursor-pointer items-center gap-2"
              >
                <span
                  className="size-2.5 rounded-full"
                  style={{backgroundColor: style.color}}
                  aria-hidden="true"
                />
                {style.label}
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {state.counts[group].toLocaleString()}
                </span>
              </label>
            </div>
          );
        })}
      </fieldset>
    </div>
  );
}

/** The panel's message while satellites aren't ready. */
function SatelliteStatus({
  status,
}: {
  status: Exclude<SatellitesState['status'], 'ready'>;
}): React.JSX.Element {
  if (status === 'unavailable') {
    return (
      <p role="status" className="text-xs text-muted-foreground">
        Satellite data isn&apos;t available yet. Try again later.
      </p>
    );
  }
  if (status === 'error') {
    return (
      <p role="alert" className="text-xs text-destructive">
        Couldn&apos;t load satellites. Reload the page to try again.
      </p>
    );
  }
  return (
    <p role="status" className="text-xs text-muted-foreground">
      Loading satellites…
    </p>
  );
}
