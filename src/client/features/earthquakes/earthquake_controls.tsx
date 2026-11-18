/**
 * @fileoverview Keyboard-accessible list and details for the earthquake layer.
 * The globe uses the same snapshot, so the list works without WebGL or a mouse.
 */
import {useId} from 'react';

import {FreshnessChip} from '@/client/features/layers';
import type {LayerSnapshotState} from '@/client/lib/use_layer_snapshot';
import type {Earthquake} from '@/shared/earthquakes';

/** Keep the layer controls small enough for the panel on a phone. */
const MAX_LIST_ITEMS = 20;

/** A failed refresh can reuse the last result for up to three intervals. */
const STALE_AFTER_MS = 15 * 60_000;

/** Format event time with the visitor's locale and local time zone. */
const eventTime = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

/** Inputs for the earthquake list and inspector. */
export interface EarthquakeControlsProps {
  /** The public snapshot and its current loading state. */
  readonly snapshot: LayerSnapshotState<Earthquake>;
  /** Event whose information is shown. */
  readonly selected: Earthquake | null;
  /** Selects an event and centres the map on it. */
  readonly onSelect: (id: string) => void;
}

/** Shows the magnitude or a clear label when USGS has not reported it. */
function magnitudeLabel(event: Earthquake): string {
  return event.magnitude === null
    ? 'Magnitude unavailable'
    : `M ${event.magnitude.toFixed(1)}`;
}

/** Shows recent earthquakes, freshness, and details for the selected result. */
export function EarthquakeControls({
  snapshot,
  selected,
  onSelect,
}: EarthquakeControlsProps): React.JSX.Element {
  const detailId = useId();
  if (snapshot.status === 'loading') {
    return <p role="status">Loading recent earthquakes…</p>;
  }
  if (snapshot.status === 'error') {
    return <p role="status">Earthquake data is temporarily unavailable.</p>;
  }

  const shown = snapshot.items.slice(0, MAX_LIST_ITEMS);
  return (
    <div className="space-y-2 text-xs">
      <FreshnessChip
        asOf={new Date(snapshot.checkedAt)}
        staleAfterMs={STALE_AFTER_MS}
      />
      {snapshot.refreshFailed && <p>Showing the last available data.</p>}
      {shown.length === 0 ? (
        <p>No earthquakes were reported in the past day.</p>
      ) : (
        <>
          <p>
            Showing {shown.length} of {snapshot.items.length}. Larger points
            represent stronger earthquakes. Amber points are from the last hour.
          </p>
          <ul
            aria-label="Recent earthquakes"
            className="max-h-36 space-y-1 overflow-y-auto"
          >
            {shown.map(event => (
              <li key={event.id}>
                <button
                  type="button"
                  aria-pressed={selected?.id === event.id}
                  aria-controls={detailId}
                  className="hover:bg-muted block min-h-8 w-full rounded px-2 py-1 text-left focus-visible:outline focus-visible:outline-2"
                  onClick={() => {
                    onSelect(event.id);
                  }}
                >
                  <span className="font-medium">{magnitudeLabel(event)}</span>{' '}
                  {event.place}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div id={detailId} aria-live="polite">
        {selected !== null && (
          <p>
            {magnitudeLabel(selected)} · {selected.place} ·{' '}
            {selected.depthKm.toFixed(1)} km depth ·{' '}
            <time dateTime={selected.occurredAt}>
              {eventTime.format(new Date(selected.occurredAt))}
            </time>
          </p>
        )}
      </div>
    </div>
  );
}
