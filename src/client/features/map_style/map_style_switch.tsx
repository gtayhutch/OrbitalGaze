/**
 * @fileoverview The "Map style" choice at the top of the layer panel.
 *
 * Layer: client feature (browser only). Rendered by the app shell in the
 * layer panel's top slot.
 *
 * Two radio buttons (native inputs, so keyboard and screen readers work
 * without extra code): the dark map, or satellite imagery from NASA.
 */
import {useId} from 'react';

import {cn} from '@/client/lib/utils';

import type {MapStyle} from './use_map_style';

/** The choices, in order, with their labels. */
const OPTIONS: readonly {value: MapStyle; label: string}[] = [
  {value: 'dark', label: 'Dark map'},
  {value: 'satellite', label: 'Satellite'},
];

/** Props for {@link MapStyleSwitch}. */
export interface MapStyleSwitchProps {
  readonly value: MapStyle;
  readonly onChange: (style: MapStyle) => void;
}

/**
 * A two-way "Dark map / Satellite" choice.
 *
 * @example
 * <MapStyleSwitch value={style} onChange={setStyle} />
 */
export function MapStyleSwitch({
  value,
  onChange,
}: MapStyleSwitchProps): React.JSX.Element {
  const name = useId();
  return (
    <fieldset>
      <legend className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Map style
      </legend>
      <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg border border-panel-border p-1">
        {OPTIONS.map(option => (
          <label
            key={option.value}
            className={cn(
              'flex cursor-pointer items-center justify-center rounded-md px-2 py-1.5 text-xs font-medium',
              'focus-within:ring-2 focus-within:ring-ring',
              value === option.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => {
                onChange(option.value);
              }}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
