/**
 * @fileoverview Panel with the followed satellite's details.
 *
 * Layer: client feature (browser only). Rendered by the app shell when a
 * satellite is selected (`?satellite=<NORAD number>`), in the same place as
 * the camera details: a panel on the right on wide screens, a bottom sheet
 * on phones.
 *
 * Height, speed and position update live from the orbit worker; the rest
 * comes from the catalogue. Focus moves to the title when the panel opens
 * and back when it closes, and Escape closes it, like the camera panel.
 */
import {Crosshair, X} from 'lucide-react';
import {useEffect, useRef} from 'react';

import {Button} from '@/client/components/ui/button';
import {
  BOTTOM_SHEET_HEIGHT_CLASS,
  formatCoordinates,
} from '@/client/features/cameras';
import {formatAge} from '@/client/features/layers';
import {useNow} from '@/client/lib/use_now';
import {cn} from '@/client/lib/utils';

import type {OrbitCatalog} from './orbit_protocol';
import {ORBIT_CLASS_LABELS, orbitClass, periodMinutes} from './orbit_math';
import {SATELLITE_GROUP_STYLES} from './satellite_groups';
import type {FollowedSatellite} from './use_satellites';

/** Props for {@link SatelliteDetailPanel}. */
export interface SatelliteDetailPanelProps {
  /** The loaded catalogue. */
  readonly catalog: OrbitCatalog;
  /** The followed satellite. */
  readonly followed: FollowedSatellite;
  /** Flies the globe to the satellite. */
  readonly onFlyTo: () => void;
  /** Closes the panel (clears the selection). */
  readonly onClose: () => void;
}

/** Whole numbers with thousands separators. */
const wholeNumber = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});

/** One decimal place. */
const oneDecimal = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Turns an OMM epoch (UTC without a zone suffix) into a Date. */
function epochDate(epoch: string): Date {
  return new Date(`${epoch}Z`);
}

/** "1998-067A" → "1998", the launch year; empty when unknown. */
function launchYear(intlDes: string): string {
  const match = /^(\d{4})-/.exec(intlDes);
  return match?.[1] ?? '';
}

/**
 * The followed satellite's details: what it is, where it is now, and its
 * orbit.
 *
 * @example
 * <SatelliteDetailPanel catalog={catalog} followed={followed} onFlyTo={fly} onClose={close} />
 */
export function SatelliteDetailPanel({
  catalog,
  followed,
  onFlyTo,
  onClose,
}: SatelliteDetailPanelProps): React.JSX.Element {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const now = useNow();
  const {index, live} = followed;
  const id = catalog.ids[index] ?? 0;
  const name = catalog.names[index] ?? '';
  const group = catalog.groups[index] ?? 'other';
  const meanMotion = catalog.meanMotion[index] ?? 0;
  const eccentricity = catalog.eccentricity[index] ?? 0;
  const inclination = catalog.inclination[index] ?? 0;
  const intlDes = catalog.intlDes[index] ?? '';
  const epoch = epochDate(catalog.epochs[index] ?? '');
  const style = SATELLITE_GROUP_STYLES[group];
  const year = launchYear(intlDes);

  // Close on Escape.
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        onClose();
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);

  // Focus the title when a satellite opens, and give focus back on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    headingRef.current?.focus();
    return () => {
      if (
        previouslyFocused instanceof HTMLElement &&
        previouslyFocused.isConnected
      ) {
        previouslyFocused.focus();
      }
    };
  }, [id]);

  return (
    <aside
      aria-labelledby="satellite-detail-title"
      className={cn(
        'pointer-events-auto absolute overflow-y-auto border border-panel-border bg-panel p-5 backdrop-blur-md',
        // Phones: bottom sheet. Wide screens: panel on the right.
        'inset-x-0 bottom-0 rounded-t-2xl',
        BOTTOM_SHEET_HEIGHT_CLASS,
        'md:inset-x-auto md:top-4 md:right-4 md:bottom-auto md:h-auto md:max-h-[calc(100dvh-2rem)] md:w-96 md:rounded-2xl',
      )}
    >
      <div className="flex items-start gap-2">
        <h2
          id="satellite-detail-title"
          ref={headingRef}
          tabIndex={-1}
          className="flex-1 text-lg leading-snug font-semibold focus:outline-none"
        >
          {name}
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close satellite details"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </Button>
      </div>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Group</dt>
        <dd className="flex items-center gap-2">
          <span
            className="size-2.5 rounded-full"
            style={{backgroundColor: style.color}}
            aria-hidden="true"
          />
          {style.label}
        </dd>
        <dt className="text-muted-foreground">Catalogue number</dt>
        <dd className="tabular-nums">{id}</dd>
        {intlDes !== '' && (
          <>
            <dt className="text-muted-foreground">Designator</dt>
            <dd className="tabular-nums">
              {intlDes}
              {year !== '' && (
                <span className="text-muted-foreground">
                  {' '}
                  (launched {year})
                </span>
              )}
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">Height</dt>
        <dd className="tabular-nums">
          {live === null ? '—' : `${wholeNumber.format(live.altitudeKm)} km`}
        </dd>
        <dt className="text-muted-foreground">Speed</dt>
        <dd className="tabular-nums">
          {live === null ? '—' : `${oneDecimal.format(live.speedKmS)} km/s`}
        </dd>
        <dt className="text-muted-foreground">Above</dt>
        <dd className="tabular-nums">
          {live === null ? '—' : formatCoordinates(live.lat, live.lng)}
        </dd>
        <dt className="text-muted-foreground">Orbit</dt>
        <dd>
          {ORBIT_CLASS_LABELS[orbitClass(meanMotion, eccentricity)]}
          <span className="block text-xs text-muted-foreground tabular-nums">
            {wholeNumber.format(periodMinutes(meanMotion))} min per orbit ·{' '}
            {oneDecimal.format(inclination)}° inclination
          </span>
        </dd>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={onFlyTo}>
          <Crosshair aria-hidden="true" />
          Fly to it
        </Button>
      </div>

      <div className="mt-4 border-t border-panel-border pt-3 text-xs text-muted-foreground">
        <p>
          Position computed in your browser from orbital elements measured{' '}
          {Number.isNaN(epoch.getTime())
            ? 'recently'
            : formatAge(now.getTime() - epoch.getTime())}
          , so it can be off by a few kilometres.
        </p>
      </div>
    </aside>
  );
}
