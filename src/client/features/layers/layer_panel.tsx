/**
 * @fileoverview The layer panel: which layers the globe shows.
 *
 * Layer: client feature (browser only). Rendered by the app shell.
 *
 * The panel is generated from the layer registry. Layers are grouped by
 * domain (Cameras, Earth, Weather, …), and each has an on/off switch, its
 * name, and a one-line summary. Groups with no layers yet are left out, so
 * there are no placeholders for features that haven't shipped.
 *
 * A layer can add its own controls under its row, such as the webcam
 * layer's category filters. The app passes those in through `layerControls`,
 * which keeps this feature independent of any one layer's code. They show
 * only while the layer is on.
 *
 * The panel can be collapsed. It starts open on wide screens and collapsed on
 * phones, where the globe needs the space.
 */
import {ChevronDown, Layers} from 'lucide-react';
import {useId, useState} from 'react';

import {Switch} from '@/client/components/ui/switch';
import {cn} from '@/client/lib/utils';

import type {LayerDefinition} from './layer_definition';
import {groupLayersByDomain, LAYER_IDS, type LayerId} from './registry';
import type {ActiveLayers} from './use_active_layers';

/** Screen width, in CSS pixels, from which the panel starts open. */
const OPEN_BY_DEFAULT_MIN_WIDTH = 768;

/** Props for {@link LayerPanel}. */
export interface LayerPanelProps {
  /** Which layers are on, and how to change that. */
  activeLayers: ActiveLayers;
  /**
   * Extra controls shown under a layer while it's on, keyed by layer ID (for
   * example the webcam category filters).
   */
  layerControls?: Readonly<Partial<Record<LayerId, React.ReactNode>>>;
  /** Extra classes for positioning. */
  className?: string;
}

/** Props for one layer's row. */
interface LayerRowProps {
  layer: LayerDefinition;
  isActive: boolean;
  onActiveChange: (active: boolean) => void;
  controls: React.ReactNode;
}

/** One layer: switch, name, summary, and its controls while it's on. */
function LayerRow({
  layer,
  isActive,
  onActiveChange,
  controls,
}: LayerRowProps): React.JSX.Element {
  const switchId = useId();
  const summaryId = useId();
  return (
    <li className="py-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={switchId} className="cursor-pointer font-medium">
          {layer.label}
        </label>
        <Switch
          id={switchId}
          checked={isActive}
          onCheckedChange={onActiveChange}
          aria-describedby={summaryId}
        />
      </div>
      <p id={summaryId} className="mt-0.5 text-xs text-muted-foreground">
        {layer.summary}
      </p>
      {isActive && controls !== undefined && (
        <div className="mt-3">{controls}</div>
      )}
    </li>
  );
}

/**
 * Collapsible panel listing every layer, grouped by domain.
 *
 * @example
 * <LayerPanel
 *   activeLayers={activeLayers}
 *   layerControls={{webcams: <CameraLayerControls index={index} filter={filter} />}}
 *   className="absolute left-4 top-24"
 * />
 */
export function LayerPanel({
  activeLayers,
  layerControls = {},
  className,
}: LayerPanelProps): React.JSX.Element {
  const contentId = useId();
  const [isOpen, setIsOpen] = useState(
    () =>
      window.matchMedia(`(min-width: ${OPEN_BY_DEFAULT_MIN_WIDTH}px)`).matches,
  );
  const groups = groupLayersByDomain();

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
        <span className="text-xs font-normal text-muted-foreground">
          {activeLayers.active.size} of {LAYER_IDS.length} on
        </span>
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
        className="max-h-[calc(100dvh-9rem)] overflow-y-auto border-t border-panel-border px-4 pt-2 pb-3"
      >
        {groups.map(group => (
          <section key={group.domain} aria-label={group.label} className="py-1">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {group.label}
            </h2>
            <ul className="divide-y divide-panel-border">
              {group.layers.map(layer => {
                // Safe: every registered layer's ID is a LayerId.
                const layerId = layer.id as LayerId;
                return (
                  <LayerRow
                    key={layerId}
                    layer={layer}
                    isActive={activeLayers.active.has(layerId)}
                    onActiveChange={active => {
                      activeLayers.setLayerActive(layerId, active);
                    }}
                    controls={layerControls[layerId]}
                  />
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
