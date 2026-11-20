/**
 * @fileoverview The registry of every layer the globe can show.
 *
 * Layer: client feature (browser only).
 *
 * Registry pattern: {@link ALL_LAYER_DEFINITIONS} is the one list of
 * layers, and {@link LAYER_DEFINITIONS} the released ones. The layer panel,
 * the credit bar, links, and saved preferences all read the released list,
 * so a new layer appears everywhere once it is added here, and a layer
 * marked `released: false` disappears everywhere at once while its code
 * stays in place. The order of the list is the order layers appear within
 * their panel group.
 */
import {EARTHQUAKE_LAYER_ID} from '@/shared/earthquakes';
import {SATELLITE_LAYER_ID} from '@/shared/satellites';

import {
  LAYER_DOMAIN_LABELS,
  LAYER_DOMAINS,
  type LayerDefinition,
  type LayerDomain,
} from './layer_definition';

/** Windy's home page, which its webcam credit must link to. */
const WINDY_HOME_URL = 'https://www.windy.com/';

/** Windy's page for adding a webcam, which its webcam credit must link to. */
const WINDY_ADD_WEBCAM_URL = 'https://www.windy.com/webcams/add';

/** Every layer that has been built, released or not, in panel order. */
export const ALL_LAYER_DEFINITIONS = [
  {
    id: 'webcams',
    domain: 'cameras',
    label: 'Public webcams',
    summary: 'Live views from public webcams around the world.',
    // Windy's API terms require this exact credit, in visible text, with
    // links to windy.com and to its page for adding a webcam.
    attribution: [
      {text: 'Webcams provided by '},
      {text: 'windy.com', href: WINDY_HOME_URL},
      {text: ' — '},
      {text: 'add a webcam', href: WINDY_ADD_WEBCAM_URL},
    ],
    defaultOn: true,
  },
  {
    id: EARTHQUAKE_LAYER_ID,
    domain: 'earth',
    label: 'Earthquakes',
    summary: 'Earthquakes reported by USGS in the past 24 hours.',
    attribution: [
      {
        text: 'USGS Earthquake Hazards Program',
        href: 'https://earthquake.usgs.gov/',
      },
    ],
    defaultOn: false,
  },
  {
    id: SATELLITE_LAYER_ID,
    domain: 'space',
    label: 'Satellites',
    summary:
      'Active satellites at their real height, moving live. Military satellites are not shown.',
    attribution: [
      {text: 'Orbital data: '},
      {text: 'CelesTrak', href: 'https://celestrak.org/'},
    ],
    defaultOn: false,
    // Paused: CelesTrak refuses requests from Cloudflare's network, so the
    // orbital data can't be fetched yet. Set back to true (and register the
    // Worker source again) once the data path works.
    released: false,
  },
] as const satisfies readonly LayerDefinition[];

/** The ID of a built layer (released or not). */
export type LayerId = (typeof ALL_LAYER_DEFINITIONS)[number]['id'];

/** The layers visitors can use, in panel order. */
export const LAYER_DEFINITIONS: readonly (LayerDefinition & {
  readonly id: LayerId;
})[] = (
  ALL_LAYER_DEFINITIONS as readonly (LayerDefinition & {
    readonly id: LayerId;
  })[]
).filter(layer => layer.released !== false);

/** All released layer IDs, in panel order. */
export const LAYER_IDS: readonly LayerId[] = LAYER_DEFINITIONS.map(
  layer => layer.id,
);

/**
 * Whether a value is the ID of a released layer. Used to clean up saved
 * preferences and links, which may name layers that no longer exist or
 * aren't released.
 *
 * @param value Anything, for example a key read from storage.
 * @returns True for a registered layer ID.
 * @example
 * isLayerId('webcams'); // true
 * isLayerId('volcanoes'); // false until that layer is registered
 */
export function isLayerId(value: unknown): value is LayerId {
  return (
    typeof value === 'string' &&
    (LAYER_IDS as readonly string[]).includes(value)
  );
}

/** A panel group and the layers in it. */
export interface LayerGroup {
  /** The group's identifier. */
  readonly domain: LayerDomain;
  /** The group's heading. */
  readonly label: string;
  /** The group's layers, in registry order. */
  readonly layers: readonly LayerDefinition[];
}

/**
 * Groups the registered layers for the panel. Groups with no layers yet are
 * left out, so the panel never shows an empty heading.
 *
 * @param definitions The layers to group; defaults to the whole registry.
 * @returns The non-empty groups, in {@link LAYER_DOMAINS} order.
 * @example
 * groupLayersByDomain(); // [{domain: 'cameras', label: 'Cameras', layers: [webcams]}]
 */
export function groupLayersByDomain(
  definitions: readonly LayerDefinition[] = LAYER_DEFINITIONS,
): readonly LayerGroup[] {
  return LAYER_DOMAINS.map(domain => ({
    domain,
    label: LAYER_DOMAIN_LABELS[domain],
    layers: definitions.filter(layer => layer.domain === domain),
  })).filter(group => group.layers.length > 0);
}
