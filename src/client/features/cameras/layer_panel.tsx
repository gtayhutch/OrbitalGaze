/**
 * @fileoverview The layer panel: which cameras the globe shows.
 *
 * Layer: client feature (browser only). Rendered by the app shell.
 *
 * Today there is one layer, public webcams, with a checkbox per category and
 * a count of cameras in each. More layers (satellites, flights, weather) will
 * be added here when they exist; there are no placeholder toggles for
 * features that haven't shipped.
 *
 * The panel can be collapsed. It starts open on wide screens and collapsed on
 * phones, where the globe needs the space.
 */
import {ChevronDown, Layers} from 'lucide-react';
import {useId, useMemo, useState} from 'react';

import {Checkbox} from '@/client/components/ui/checkbox';
import {cn} from '@/client/lib/utils';
import {CAMERA_CATEGORIES, type CameraCategory} from '@/shared/cameras';

import {CATEGORY_STYLES} from './category_style';
import type {CategoryFilter} from './use_category_filter';
import type {CameraIndexState} from './use_camera_index';

/** Screen width, in CSS pixels, from which the panel starts open. */
const OPEN_BY_DEFAULT_MIN_WIDTH = 768;

/** Props for {@link LayerPanel}. */
export interface LayerPanelProps {
  /** The camera index, for counts and loading or error messages. */
  index: CameraIndexState;
  /** Which categories are visible, and how to change that. */
  filter: CategoryFilter;
  /** Extra classes for positioning. */
  className?: string;
}

/** Counts the cameras in each category. */
function countByCategory(
  index: CameraIndexState,
): Record<CameraCategory, number> {
  // Safe: the entries cover every category, which is what the type promises.
  const counts = Object.fromEntries(
    CAMERA_CATEGORIES.map(category => [category, 0]),
  ) as Record<CameraCategory, number>;
  if (index.status === 'ready') {
    for (const camera of index.cameras) {
      counts[camera.category] += 1;
    }
  }
  return counts;
}

/**
 * Collapsible panel with the webcam layer's category filters.
 *
 * @example
 * <LayerPanel index={index} filter={filter} className="absolute left-4 top-24" />
 */
export function LayerPanel({
  index,
  filter,
  className,
}: LayerPanelProps): React.JSX.Element {
  const contentId = useId();
  const [isOpen, setIsOpen] = useState(
    () =>
      window.matchMedia(`(min-width: ${OPEN_BY_DEFAULT_MIN_WIDTH}px)`).matches,
  );
  const counts = useMemo(() => countByCategory(index), [index]);
  const visibleTotal =
    index.status === 'ready'
      ? index.cameras.filter(camera => filter.visible.has(camera.category))
          .length
      : 0;

  return (
    <section
      aria-label="Layers"
      className={cn(
        'w-72 rounded-xl border border-panel-border bg-panel text-sm backdrop-blur-md',
        className,
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={() => {
          setIsOpen(open => !open);
        }}
      >
        <Layers className="size-4 text-primary" aria-hidden="true" />
        Layers
        <ChevronDown
          className={cn(
            'ml-auto size-4 transition-transform',
            isOpen && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>

      <div
        id={contentId}
        hidden={!isOpen}
        className="border-t border-panel-border px-4 pt-3 pb-4"
      >
        <div className="flex items-baseline justify-between">
          <h2 className="font-medium">Public webcams</h2>
          {index.status === 'ready' && (
            <span className="text-xs text-muted-foreground">
              {visibleTotal.toLocaleString()} shown
            </span>
          )}
        </div>

        {index.status === 'loading' && (
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            Loading cameras…
          </p>
        )}
        {index.status === 'error' && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            Couldn&apos;t load cameras. Reload the page to try again.
          </p>
        )}

        <fieldset className="mt-3 space-y-2">
          <legend className="sr-only">Camera categories</legend>
          {CAMERA_CATEGORIES.map(category => {
            const checkboxId = `${contentId}-${category}`;
            const style = CATEGORY_STYLES[category];
            return (
              <div key={category} className="flex items-center gap-3">
                <Checkbox
                  id={checkboxId}
                  checked={filter.visible.has(category)}
                  onCheckedChange={checked => {
                    filter.setCategoryVisible(category, checked === true);
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
                    {counts[category].toLocaleString()}
                  </span>
                </label>
              </div>
            );
          })}
        </fieldset>
      </div>
    </section>
  );
}
