/**
 * @fileoverview Creates and configures the CesiumJS viewer behind the globe.
 *
 * Layer: client feature (browser only). Used by `globe_view.tsx`, which owns
 * the viewer's lifetime inside React.
 *
 * Pattern: Strategy, for the base map imagery. `chooseBaseImagery` picks one of
 * two interchangeable imagery sources based on configuration:
 * - with a Cesium ion token: global satellite imagery streamed from Cesium ion;
 * - without one: the low-resolution Natural Earth II imagery that ships inside
 *   the Cesium package and is served from our own origin. This keeps local
 *   development and automated tests working with no account and no network.
 *
 * Cesium's built-in widgets (timeline, search box, layer picker, and so on)
 * are all turned off, because the app draws its own interface on top.
 * Imagery credits stay on, as the imagery providers' terms require.
 */
import {
  buildModuleUrl,
  ImageryLayer,
  Ion,
  TileMapServiceImageryProvider,
  Viewer,
} from 'cesium';

/** Options for {@link createGlobeViewer}. */
export interface GlobeViewerOptions {
  /** Cesium ion token; when absent, the bundled offline imagery is used. */
  readonly cesiumIonToken: string | undefined;
}

/** Which base imagery the globe shows; see the file header. */
export type BaseImageryKind = 'ion-world-imagery' | 'bundled-natural-earth';

/**
 * Picks the base imagery for the given token.
 *
 * @param cesiumIonToken The configured Cesium ion token, if any.
 * @returns Which imagery to use.
 */
export function chooseBaseImagery(
  cesiumIonToken: string | undefined,
): BaseImageryKind {
  return cesiumIonToken === undefined
    ? 'bundled-natural-earth'
    : 'ion-world-imagery';
}

/**
 * Builds the imagery layer for a given choice.
 *
 * The layer loads asynchronously; Cesium shows the plain globe until the
 * first tiles arrive.
 */
function buildBaseLayer(kind: BaseImageryKind): ImageryLayer {
  if (kind === 'ion-world-imagery') {
    return ImageryLayer.fromWorldImagery({});
  }
  // The Natural Earth II tiles are copied to /cesium/Assets at build time.
  const tilesUrl = buildModuleUrl('Assets/Textures/NaturalEarthII');
  return ImageryLayer.fromProviderAsync(
    TileMapServiceImageryProvider.fromUrl(tilesUrl),
    {},
  );
}

/**
 * Creates a Cesium viewer inside `container`, configured for OrbitalGaze.
 *
 * The caller owns the returned viewer and must call `viewer.destroy()` when
 * the container goes away, or its WebGL context and web workers leak.
 *
 * @param container The element the globe fills.
 * @param options Imagery settings.
 * @returns The new viewer.
 * @throws {Error} If the browser can't create a WebGL context (for example,
 *     WebGL is disabled or the GPU is blocklisted).
 * @example
 * const viewer = createGlobeViewer(element, {cesiumIonToken: undefined});
 * // later
 * viewer.destroy();
 */
export function createGlobeViewer(
  container: HTMLElement,
  options: GlobeViewerOptions,
): Viewer {
  // Step 1: choose imagery. The ion token must be set before any ion request.
  const imageryKind = chooseBaseImagery(options.cesiumIonToken);
  if (options.cesiumIonToken !== undefined) {
    Ion.defaultAccessToken = options.cesiumIonToken;
  }

  // Step 2: create the viewer with every built-in widget off.
  const viewer = new Viewer(container, {
    baseLayer: buildBaseLayer(imageryKind),
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    // Render only when something changes, instead of 60 times a second. This
    // saves battery on laptops and phones while the globe sits still.
    requestRenderMode: true,
    maximumRenderTimeChange: Number.POSITIVE_INFINITY,
  });

  // Step 3: scene look. Lighting shades the night side of the Earth using the
  // real sun position for the current time.
  viewer.scene.globe.enableLighting = true;

  return viewer;
}
