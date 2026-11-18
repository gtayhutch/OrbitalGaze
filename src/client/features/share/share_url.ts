/**
 * @fileoverview Builds the link that "Share this view" copies.
 *
 * Layer: client feature (browser only). Pure function.
 *
 * The address bar already carries the view (`?view=`, kept current as the
 * camera moves) and the selected camera (`?camera=`). The share link adds
 * the active layers (`?layers=`). The layers stay out of the address bar
 * itself, so a visitor's own saved layer choices keep working on reload.
 */
import type {LayerId} from '@/client/features/layers';

import {encodeLayers, LAYERS_URL_PARAM} from './view_codec';

/**
 * Adds the active layers to the current address.
 *
 * @param currentHref The page's current URL (`window.location.href`).
 * @param activeLayers The layers that are on.
 * @returns The link to share.
 * @example
 * buildShareUrl('https://orbitalgaze.com/?view=1_0_0_1000_0_-90', new Set(['webcams']));
 * // "https://orbitalgaze.com/?view=1_0_0_1000_0_-90&layers=webcams"
 */
export function buildShareUrl(
  currentHref: string,
  activeLayers: ReadonlySet<LayerId>,
): string {
  const url = new URL(currentHref);
  url.searchParams.set(LAYERS_URL_PARAM, encodeLayers(activeLayers));
  return url.href;
}
