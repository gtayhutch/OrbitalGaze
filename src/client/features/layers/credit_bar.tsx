/**
 * @fileoverview The credits for every layer that's on.
 *
 * Layer: client feature (browser only). Shown in the globe's credit strip.
 *
 * Data providers' terms require a visible credit whenever their data is on
 * screen (Windy, for example, asks for "Webcams provided by windy.com — add
 * a webcam" with both links). The bar lists the credit of each active layer,
 * taken from the layer registry, and disappears when no layer is on. The
 * basemap's credit is separate; the globe shows it below this bar.
 */
import {cn} from '@/client/lib/utils';

import type {AttributionPart} from './layer_definition';
import {LAYER_DEFINITIONS, type LayerId} from './registry';

/** Props for {@link CreditBar}. */
export interface CreditBarProps {
  /** The layers that are on. */
  active: ReadonlySet<LayerId>;
  /** Extra classes. */
  className?: string;
}

/** One part of a credit: plain text or a link that opens in a new tab. */
function CreditPart({part}: {part: AttributionPart}): React.JSX.Element {
  if (part.href === undefined) {
    return <>{part.text}</>;
  }
  return (
    <a
      href={part.href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:text-foreground"
    >
      {part.text}
    </a>
  );
}

/**
 * The active layers' credits, one per line; nothing when no layer is on.
 *
 * @example
 * <GlobeView credits={<CreditBar active={activeLayers.active} />} … />
 */
export function CreditBar({
  active,
  className,
}: CreditBarProps): React.JSX.Element | null {
  const credited = LAYER_DEFINITIONS.filter(layer => active.has(layer.id));
  if (credited.length === 0) {
    return null;
  }
  return (
    <ul
      aria-label="Data credits"
      className={cn(
        'rounded bg-background/70 px-1.5 py-0.5 backdrop-blur-sm',
        className,
      )}
    >
      {credited.map(layer => (
        <li key={layer.id}>
          {layer.attribution.map((part, index) => (
            // The parts never change order, so position plus text is a
            // stable key.
            <CreditPart key={`${String(index)}-${part.text}`} part={part} />
          ))}
        </li>
      ))}
    </ul>
  );
}
