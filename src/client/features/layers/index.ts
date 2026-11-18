/**
 * @fileoverview Public interface of the layers feature.
 *
 * Layer: client feature (browser only).
 *
 * The layer registry (every layer the globe can show), which layers are on,
 * the grouped layer panel, the credit bar, and the data-freshness chip. Each
 * layer's own data and drawing code lives in its own feature (for example
 * cameras and globe). This feature only knows each layer's description.
 */
export {CreditBar, type CreditBarProps} from './credit_bar';
export {describeFreshness, formatAge, type Freshness} from './freshness';
export {FreshnessChip, type FreshnessChipProps} from './freshness_chip';
export {
  LAYER_DOMAIN_LABELS,
  LAYER_DOMAINS,
  type AttributionPart,
  type LayerDefinition,
  type LayerDomain,
} from './layer_definition';
export {LayerPanel, type LayerPanelProps} from './layer_panel';
export {
  groupLayersByDomain,
  isLayerId,
  LAYER_DEFINITIONS,
  LAYER_IDS,
  type LayerGroup,
  type LayerId,
} from './registry';
export {
  LAYER_CHOICES_STORAGE_KEY,
  useActiveLayers,
  type ActiveLayers,
} from './use_active_layers';
