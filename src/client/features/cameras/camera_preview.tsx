/**
 * @fileoverview The preview area of the camera detail panel.
 *
 * Layer: client feature (browser only). Rendered by `CameraDetailPanel`.
 *
 * Shows the camera's latest image, loaded straight from the provider
 * (Windy), as its terms require:
 * - the image is shown at its own size or smaller, never stretched;
 * - the image links to the camera's page on windy.com.
 *
 * The timelapse or live player is a third-party page, so it loads only when
 * the visitor asks for it. Until then nothing from the player runs. It is
 * embedded in a sandboxed frame from an allowlisted host (the server checks
 * every link, and the Content-Security-Policy repeats the check).
 */
import {ExternalLink, ImageOff, Play, Radio, RotateCw} from 'lucide-react';
import {useState} from 'react';

import {Button} from '@/client/components/ui/button';
import type {CameraDetail, CameraFeed} from '@/shared/cameras';

import {useCameraFeed, type CameraFeedState} from './use_camera_feed';

/** Which player the visitor opened, if any. */
type OpenPlayer = 'timelapse' | 'live' | null;

/** A placeholder box with an icon, a message, and an optional action. */
function PreviewMessage({
  title,
  detail,
  action,
  busy = false,
}: {
  title: string;
  detail?: string;
  action?: React.ReactNode;
  busy?: boolean;
}): React.JSX.Element {
  return (
    <div
      className="mt-4 grid aspect-video place-items-center rounded-lg border border-panel-border bg-background/60 p-4 text-center"
      aria-busy={busy}
    >
      <div>
        <ImageOff
          className="mx-auto size-6 text-muted-foreground"
          aria-hidden="true"
        />
        <p
          className="mt-2 text-sm font-medium"
          role={busy ? 'status' : undefined}
        >
          {title}
        </p>
        {detail !== undefined && (
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        )}
        {action}
      </div>
    </div>
  );
}

/** The image and player controls once the feed has loaded. */
function LoadedPreview({
  camera,
  feed,
  onImageError,
}: {
  camera: CameraDetail;
  feed: CameraFeed;
  onImageError: () => void;
}): React.JSX.Element {
  const [openPlayer, setOpenPlayer] = useState<OpenPlayer>(null);
  const playerUrl =
    openPlayer === 'live'
      ? feed.liveUrl
      : openPlayer === 'timelapse'
        ? feed.timelapseUrl
        : null;

  return (
    <div className="mt-4">
      {playerUrl === null ? (
        // The image links to the camera's page on windy.com, as Windy asks.
        <a
          href={feed.pageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block overflow-hidden rounded-lg border border-panel-border bg-background/60"
        >
          <img
            src={feed.imageUrl}
            alt={`Latest image from ${camera.title}`}
            // Intrinsic size: the image never grows past it.
            width={feed.imageWidth ?? undefined}
            height={feed.imageHeight ?? undefined}
            className="mx-auto block h-auto max-w-full"
            referrerPolicy="strict-origin-when-cross-origin"
            onError={onImageError}
          />
          <span className="sr-only">
            View this camera on windy.com (opens in a new tab)
          </span>
        </a>
      ) : (
        <div className="aspect-video overflow-hidden rounded-lg border border-panel-border bg-black">
          <iframe
            src={playerUrl}
            title={`${openPlayer === 'live' ? 'Live view' : 'Timelapse'} of ${camera.title}`}
            className="size-full"
            sandbox="allow-scripts allow-same-origin allow-popups"
            referrerPolicy="strict-origin-when-cross-origin"
            loading="lazy"
            allow="fullscreen"
          />
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {playerUrl !== null && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setOpenPlayer(null);
            }}
          >
            Show latest image
          </Button>
        )}
        {feed.liveUrl !== null && openPlayer !== 'live' && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setOpenPlayer('live');
            }}
          >
            <Radio aria-hidden="true" />
            Watch live
          </Button>
        )}
        {feed.timelapseUrl !== null && openPlayer !== 'timelapse' && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setOpenPlayer('timelapse');
            }}
          >
            <Play aria-hidden="true" />
            Watch today&apos;s timelapse
          </Button>
        )}
        <a
          href={feed.pageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
        >
          windy.com
          <ExternalLink className="size-3" aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
    </div>
  );
}

/** Renders the preview for one feed state. */
function PreviewForState({
  camera,
  state,
  retry,
  onImageError,
}: {
  camera: CameraDetail;
  state: CameraFeedState;
  retry: () => void;
  onImageError: () => void;
}): React.JSX.Element {
  switch (state.status) {
    case 'idle':
    case 'unavailable':
      return (
        <PreviewMessage
          title="Preview not available"
          detail="This camera has no image to show right now."
        />
      );
    case 'loading':
      return <PreviewMessage title="Loading the latest image…" busy />;
    case 'error':
      return (
        <PreviewMessage
          title="The preview can't be loaded right now"
          action={
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={retry}
            >
              <RotateCw aria-hidden="true" />
              Try again
            </Button>
          }
        />
      );
    case 'ready':
      return (
        <LoadedPreview
          // A new set of links starts with the image, not an open player.
          key={state.feed.imageUrl}
          camera={camera}
          feed={state.feed}
          onImageError={onImageError}
        />
      );
  }
}

/**
 * The preview area for a camera: its latest image and players, or a clear
 * message when there's nothing to show.
 *
 * @example
 * <CameraPreview camera={camera} />
 */
export function CameraPreview({
  camera,
}: {
  camera: CameraDetail;
}): React.JSX.Element {
  const {state, retry} = useCameraFeed(camera.hasFeed ? camera.id : null);
  // Image links can expire before the scheduled refresh (for example after
  // the laptop slept). The first failed image fetches fresh links once; a
  // second failure shows the error, so a broken image can't loop.
  const [imageFailures, setImageFailures] = useState({
    cameraId: camera.id,
    count: 0,
  });
  const failures =
    imageFailures.cameraId === camera.id ? imageFailures.count : 0;

  const onImageError = (): void => {
    setImageFailures({cameraId: camera.id, count: failures + 1});
    if (failures === 0) {
      retry();
    }
  };
  const retryByVisitor = (): void => {
    setImageFailures({cameraId: camera.id, count: 0});
    retry();
  };

  const shownState: CameraFeedState =
    failures >= 2 && state.status === 'ready' ? {status: 'error'} : state;
  return (
    <PreviewForState
      camera={camera}
      state={shownState}
      retry={retryByVisitor}
      onImageError={onImageError}
    />
  );
}
