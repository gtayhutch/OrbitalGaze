/**
 * @fileoverview Looks up a camera's current image and player links.
 *
 * Layer: worker feature service (server only). Called by the feed route.
 *
 * Today only Windy cameras have feeds. Windy's terms require showing its
 * images through the links its API returns, so the Worker never downloads
 * or re-hosts them: it asks Windy for fresh links (they expire after 10
 * minutes on the free tier), checks them, and hands them to the browser,
 * which loads them straight from Windy.
 *
 * Every link is checked before it leaves the server: it must be https, on
 * the default port, on a host the camera's source allows. Windy's data is
 * input like any other, and a link to an unexpected host is dropped.
 */
import type {CameraFeed} from '@/shared/cameras';

import {AppError} from '../../lib/errors';
import type {Logger} from '../../lib/logger';
import {isAllowedUrl, OutboundError} from '../../lib/outbound_fetch';
import type {CameraRepository} from './repository';
import {WINDY_SOURCE_ID} from './sources/windy/adapter';
import {isWindyKeyRejected, type WindyClient} from './sources/windy/client';

/**
 * How long feed links are treated as valid. Windy's free-tier image tokens
 * last 10 minutes; one minute is kept in hand.
 */
export const FEED_LINK_LIFETIME_MS = 9 * 60 * 1000;

/** Message shown when the provider can't be reached. */
const FEED_UNAVAILABLE_MESSAGE = "The preview can't be loaded right now.";

/**
 * Returns `link` if it is safe to give browsers, otherwise `null`.
 *
 * @param link A link from the provider, or nothing.
 * @param allowedHosts The hosts the source allows.
 * @returns The normalized link, or `null`.
 */
function checkedLink(
  link: string | undefined,
  allowedHosts: readonly string[],
): string | null {
  if (link === undefined) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  return isAllowedUrl(url, allowedHosts) ? url.toString() : null;
}

/**
 * Loads a camera's current feed.
 *
 * @param deps The camera repository, the Windy client (`null` when no key is
 *     set), the current time, and the request's logger.
 * @param id The camera ID, already validated.
 * @returns The feed, or `null` when the camera is unknown, hidden, has no
 *     feed, or the provider has nothing safe to show.
 * @throws {AppError} `INTERNAL` when the provider can't be reached or
 *     answers badly. Nothing from the provider is put in the message.
 */
export async function loadCameraFeed(
  deps: {
    cameras: CameraRepository;
    windy: WindyClient | null;
    now: Date;
    logger: Logger;
  },
  id: string,
): Promise<CameraFeed | null> {
  // Step 1: find where the feed comes from. Unknown, hidden, and feedless
  // cameras all end here, the same way.
  const reference = await deps.cameras.findFeedReference(id);
  if (reference?.sourceId !== WINDY_SOURCE_ID || deps.windy === null) {
    return null;
  }

  // Step 2: ask Windy for fresh links.
  let webcam;
  try {
    webcam = await deps.windy.getWebcamFeed(reference.streamRef);
  } catch (error) {
    if (isWindyKeyRejected(error)) {
      deps.logger.error('Windy rejected the API key', {cameraId: id});
    } else {
      deps.logger.warn('Windy feed request failed', {
        cameraId: id,
        failure: error instanceof OutboundError ? error.failure : 'unknown',
        status: error instanceof OutboundError ? error.status : null,
      });
    }
    throw new AppError('INTERNAL', FEED_UNAVAILABLE_MESSAGE);
  }
  if (webcam === null) {
    return null;
  }

  // Step 3: keep only links on the source's allowed hosts. Without a usable
  // image there is nothing to show.
  const hosts = reference.allowedHosts;
  const preview = checkedLink(webcam.images?.current.preview, hosts);
  const imageUrl =
    preview ?? checkedLink(webcam.images?.current.thumbnail, hosts);
  const pageUrl = checkedLink(webcam.urls?.detail, hosts);
  if (imageUrl === null || pageUrl === null) {
    deps.logger.warn('Windy feed links failed the host check', {cameraId: id});
    return null;
  }
  const size =
    preview === null
      ? webcam.images?.sizes?.thumbnail
      : webcam.images?.sizes?.preview;

  return {
    kind: 'windy',
    imageUrl,
    imageWidth: size?.width ?? null,
    imageHeight: size?.height ?? null,
    pageUrl,
    timelapseUrl: checkedLink(webcam.player?.day, hosts),
    liveUrl: checkedLink(webcam.player?.live, hosts),
    expiresAt: new Date(
      deps.now.getTime() + FEED_LINK_LIFETIME_MS,
    ).toISOString(),
  };
}
