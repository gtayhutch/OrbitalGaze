/**
 * @fileoverview Small label saying how recent a layer's data is.
 *
 * Layer: client feature (browser only). Used inside layer controls.
 *
 * Shows, for example, "List updated 4 min ago". Data older than its layer
 * expects gets a warning dot and the word "stale", so the state never relies
 * on colour alone. The text refreshes once a minute.
 */
import {useNow} from '@/client/lib/use_now';
import {cn} from '@/client/lib/utils';

import {describeFreshness} from './freshness';

/** Props for {@link FreshnessChip}. */
export interface FreshnessChipProps {
  /** When the data was last updated. */
  asOf: Date;
  /** Data older than this, in milliseconds, is shown as stale. */
  staleAfterMs: number;
  /** Words before the age; defaults to "Updated". */
  prefix?: string;
  /** Extra classes. */
  className?: string;
}

/**
 * "Updated 4 min ago", with a colour dot and "stale" when the data is old.
 *
 * @example
 * <FreshnessChip asOf={new Date(index.generatedAt)} staleAfterMs={DAY_MS} />
 */
export function FreshnessChip({
  asOf,
  staleAfterMs,
  prefix = 'Updated',
  className,
}: FreshnessChipProps): React.JSX.Element {
  const now = useNow();
  const {state, age} = describeFreshness({asOf, now, staleAfterMs});

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs text-muted-foreground',
        className,
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          state === 'fresh' ? 'bg-primary' : 'bg-warning',
        )}
        aria-hidden="true"
      />
      <time dateTime={asOf.toISOString()}>
        {prefix} {age}
      </time>
      {state === 'stale' && <span>· stale</span>}
    </span>
  );
}
