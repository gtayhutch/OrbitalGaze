/**
 * @fileoverview The webcam layer's controls in the layer panel.
 *
 * Layer: client feature (browser only). Passed to the layer panel by the app
 * shell and shown under the "Public webcams" row while that layer is on.
 *
 * Shows how many cameras are on the globe, how recently the camera list
 * changed, loading and error messages, and a checkbox per category with a
 * count of cameras in each.
 */
import {useId, useMemo} from 'react';

import {Checkbox} from '@/client/components/ui/checkbox';
import {FreshnessChip} from '@/client/features/layers';
import {CAMERA_CATEGORIES, type CameraCategory} from '@/shared/cameras';

import {CATEGORY_STYLES} from './category_style';
import type {CategoryFilter} from './use_category_filter';
import type {CameraIndexState} from './use_camera_index';

/**
 * The camera list counts as stale after three days. It's rebuilt whenever
 * cameras change, which normally happens several times a day.
 */
const CAMERA_LIST_STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

/** Props for {@link CameraLayerControls}. */
export interface CameraLayerControlsProps {
  /** The camera index, for counts, freshness, and loading or error messages. */
  index: CameraIndexState;
  /** Which categories are visible, and how to change that. */
  filter: CategoryFilter;
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

/** The index's update time as a date, or `null` if it's missing or invalid. */
function generatedAtOf(index: CameraIndexState): Date | null {
  if (index.status !== 'ready') {
    return null;
  }
  const date = new Date(index.generatedAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Camera count, freshness, and category filters for the webcam layer.
 *
 * @example
 * <LayerPanel layerControls={{webcams: <CameraLayerControls index={index} filter={filter} />}} … />
 */
export function CameraLayerControls({
  index,
  filter,
}: CameraLayerControlsProps): React.JSX.Element {
  const baseId = useId();
  const counts = useMemo(() => countByCategory(index), [index]);
  const generatedAt = generatedAtOf(index);
  const visibleTotal =
    index.status === 'ready'
      ? index.cameras.filter(camera => filter.visible.has(camera.category))
          .length
      : 0;

  return (
    <div>
      {index.status === 'ready' && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-xs text-muted-foreground tabular-nums">
            {visibleTotal.toLocaleString()} shown
          </span>
          {generatedAt !== null && (
            <FreshnessChip
              asOf={generatedAt}
              staleAfterMs={CAMERA_LIST_STALE_AFTER_MS}
              prefix="List updated"
            />
          )}
        </div>
      )}
      {index.status === 'loading' && (
        <p role="status" className="text-xs text-muted-foreground">
          Loading cameras…
        </p>
      )}
      {index.status === 'error' && (
        <p role="alert" className="text-xs text-destructive">
          Couldn&apos;t load cameras. Reload the page to try again.
        </p>
      )}

      <fieldset className="mt-3 space-y-2">
        <legend className="sr-only">Camera categories</legend>
        {CAMERA_CATEGORIES.map(category => {
          const checkboxId = `${baseId}-${category}`;
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
  );
}
