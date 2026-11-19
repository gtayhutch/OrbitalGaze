/**
 * @fileoverview The globe's map style: a dark, labelled vector basemap.
 *
 * Layer: client feature (browser only). Used by `create_map.ts`.
 *
 * The basemap's look comes from Protomaps' "dark" flavour (the
 * `@protomaps/basemaps` package builds the MapLibre layers), tinted to our
 * palette: a deep-navy ocean, slate land and teal borders.
 *
 * Everything the style loads comes from our own origin:
 * - tiles from the Worker (`/api/v1/basemap/…`), described by its TileJSON;
 * - label fonts and map icons from `public/basemap/` (see its NOTICE.txt).
 *
 * The style starts with only the background and sky. The basemap's layers
 * are added once its TileJSON arrives ({@link basemapLayers}), so the globe
 * appears at once and still works, without streets and labels, when no
 * basemap archive is available (for example a fresh local checkout).
 */
import {layers, namedFlavor, type Flavor} from '@protomaps/basemaps';
import type {
  LayerSpecification,
  StyleSpecification,
  VectorSourceSpecification,
} from 'maplibre-gl';
import {z} from 'zod';

/** ID of the basemap's vector source in the style. */
export const BASEMAP_SOURCE_ID = 'basemap';

/** Path of the basemap's TileJSON on our API. */
export const BASEMAP_TILEJSON_PATH = '/api/v1/basemap/tiles.json';

/** Where the tile URLs in the TileJSON must point (our own Worker). */
const BASEMAP_TILE_PATH_PREFIX = '/api/v1/basemap/tiles/';

/** Where the label fonts are, by font name and glyph range. */
const GLYPHS_PATH = '/basemap/fonts/{fontstack}/{range}.pbf';

/** The map icon sheet (MapLibre adds `.json`/`.png` and `@2x`). */
const SPRITE_PATH = '/basemap/sprites/dark';

/** Language for place names; names without an English form show locally. */
const LABEL_LANGUAGE = 'en';

/** Colour outside the globe (space). */
export const SPACE_COLOUR = '#03060c';

/**
 * Protomaps' dark flavour with our palette. Only the colours that set the
 * overall mood change; roads, parks and labels keep Protomaps' tuning.
 */
const FLAVOUR: Flavor = {
  ...namedFlavor('dark'),
  background: '#05080f',
  earth: '#121c2b',
  water: '#03060d',
  boundaries: '#2f6f7a',
  country_label: '#8fb3c4',
  city_label: '#b4c2d0',
  city_label_halo: '#03060d',
  ocean_label: '#35546c',
  buildings: '#0d1520',
  park_a: '#122420',
  park_b: '#122420',
};

/** The parts of the Worker's TileJSON the style uses. */
export interface BasemapSource {
  /** Tile URL templates on our own origin, with the archive version. */
  readonly tiles: readonly string[];
  readonly minzoom: number;
  readonly maxzoom: number;
}

/**
 * Builds the schema for the Worker's TileJSON. Tile URLs must be on
 * `origin` and under the basemap tile path, so a tampered response can't
 * point the map anywhere else.
 */
function tileJsonSchema(origin: string): z.ZodType<BasemapSource> {
  const tilePrefix = `${origin}${BASEMAP_TILE_PATH_PREFIX}`;
  return z.object({
    tiles: z
      .array(
        z
          .string()
          .max(512)
          .refine(url => url.startsWith(tilePrefix), {
            message: 'Tile URLs must point at our own basemap route.',
          }),
      )
      .min(1)
      .max(4),
    minzoom: z.number().int().min(0).max(22),
    maxzoom: z.number().int().min(0).max(22),
  });
}

/**
 * Loads the basemap's description from the Worker.
 *
 * @param origin The site's origin, for example `https://orbitalgaze.com`.
 * @param signal Cancels the request when the globe goes away.
 * @returns The basemap source, or `null` when the site has no basemap yet
 *     (the API answers 404).
 * @throws {Error} For any other failed request or an unexpected response.
 * @example
 * const source = await fetchBasemapSource(location.origin, controller.signal);
 */
export async function fetchBasemapSource(
  origin: string,
  signal: AbortSignal,
): Promise<BasemapSource | null> {
  const response = await fetch(`${origin}${BASEMAP_TILEJSON_PATH}`, {signal});
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `The basemap description failed with status ${String(response.status)}.`,
    );
  }
  return tileJsonSchema(origin).parse(await response.json());
}

/**
 * The style the globe starts with: globe projection, the sky and
 * atmosphere, and the background. Fonts and icons are set here so the
 * basemap and our own labels (cluster counts) can use them.
 *
 * @param origin The site's origin; MapLibre needs absolute asset URLs.
 * @returns A MapLibre style with no data sources yet.
 */
export function buildBaseStyle(origin: string): StyleSpecification {
  return {
    version: 8,
    projection: {type: 'globe'},
    sky: {
      'sky-color': '#0b1324',
      'horizon-color': '#1d3b5c',
      // A visible atmosphere from space, fading out as the view nears the
      // ground (zoom 5 to 7).
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 5, 1, 7, 0],
    },
    glyphs: `${origin}${GLYPHS_PATH}`,
    sprite: `${origin}${SPRITE_PATH}`,
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: {'background-color': FLAVOUR.background},
      },
    ],
  };
}

/**
 * The basemap's vector source, as MapLibre expects it.
 *
 * @param source The Worker's TileJSON.
 * @returns The source specification.
 */
export function basemapSourceSpec(
  source: BasemapSource,
): VectorSourceSpecification {
  return {
    type: 'vector',
    tiles: [...source.tiles],
    minzoom: source.minzoom,
    maxzoom: source.maxzoom,
    // The credit is shown by the globe's own credit strip.
  };
}

/**
 * The basemap's layers (land, water, roads, borders, labels), without the
 * background, which the base style already has.
 *
 * @returns Layers that read from {@link BASEMAP_SOURCE_ID}.
 */
export function basemapLayers(): LayerSpecification[] {
  return layers(BASEMAP_SOURCE_ID, FLAVOUR, {lang: LABEL_LANGUAGE}).filter(
    layer => layer.type !== 'background',
  );
}
