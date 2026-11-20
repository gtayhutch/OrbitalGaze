/**
 * @fileoverview What the app needs to know about a map layer.
 *
 * Layer: client feature (browser only). Used by the layer registry.
 *
 * Every layer the globe can show (webcams today; earthquakes, satellites, and
 * others later) is described by one {@link LayerDefinition}. The layer panel,
 * the credit bar, and later share links are all generated from these
 * definitions, so adding a layer means adding one entry to the registry
 * instead of editing each of those places.
 *
 * Only fields something reads today are here. Later layers add fields (how to
 * draw them, what their detail panel shows) when the first layer needs them.
 */

/** The groups the layer panel shows, in display order. */
export const LAYER_DOMAINS = [
  'cameras',
  'earth',
  'weather',
  'space',
  'air-sea',
  'infrastructure',
] as const;

/** One group of related layers in the panel. */
export type LayerDomain = (typeof LAYER_DOMAINS)[number];

/** Heading shown for each group in the layer panel. */
export const LAYER_DOMAIN_LABELS: Readonly<Record<LayerDomain, string>> = {
  cameras: 'Cameras',
  earth: 'Earth',
  weather: 'Weather',
  space: 'Space',
  'air-sea': 'Air & sea',
  infrastructure: 'Infrastructure',
};

/**
 * One piece of a credit line: plain text, or text linking to the data
 * provider. Links always open in a new tab.
 */
export interface AttributionPart {
  /** The words shown. */
  readonly text: string;
  /** Where the words link to; https only (checked by the registry tests). */
  readonly href?: string;
}

/** Everything the app needs to know about one layer. */
export interface LayerDefinition {
  /** Stable identifier, also used in saved preferences. */
  readonly id: string;
  /** Which panel group the layer belongs to. */
  readonly domain: LayerDomain;
  /** Name shown in the layer panel. */
  readonly label: string;
  /** One sentence on what the layer shows, under its name. */
  readonly summary: string;
  /**
   * The credit the data provider requires, shown in the credit bar whenever
   * the layer is on.
   */
  readonly attribution: readonly AttributionPart[];
  /** Whether the layer is on for visitors who haven't chosen yet. */
  readonly defaultOn: boolean;
  /**
   * `false` keeps a built layer out of the app (panel, links, saved
   * choices, credits) until its data is available. Omitted means released.
   */
  readonly released?: boolean;
}
