/**
 * @fileoverview The detail panel for the selected camera.
 *
 * Layer: client feature (browser only). Rendered by the app shell.
 *
 * Shows what we actually know about a camera: its name, place, local time,
 * category, status, and the source's attribution, plus its latest image and
 * players (`camera_preview.tsx`). When a camera has no feed the preview area
 * says so plainly instead of showing a fake player.
 *
 * Layout: a panel on the right on wide screens, a bottom sheet on phones.
 * The sheet has a fixed height ({@link BOTTOM_SHEET_HEIGHT_CLASS}) so the
 * globe's credits can sit just above it.
 * Accessibility: focus moves to the camera's title when it opens and back to
 * where it was when it closes; Esc and the close button both close it.
 */
import {ExternalLink, X} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';

import {Button} from '@/client/components/ui/button';
import {formatPlace} from '@/client/lib/format';
import {cn} from '@/client/lib/utils';
import type {CameraDetail} from '@/shared/cameras';

import {CameraPreview} from './camera_preview';
import {CATEGORY_STYLES} from './category_style';
import type {CameraDetailState} from './use_camera_detail';

/**
 * Height of the bottom sheet on phones. The globe moves its credits above
 * the sheet by the same amount (`globe_view.tsx`), so keep the two in step.
 */
export const BOTTOM_SHEET_HEIGHT_CLASS = 'h-[60dvh]';

/** How often the camera's local time is refreshed, in milliseconds. */
const LOCAL_TIME_REFRESH_MS = 30_000;

/** Props for {@link CameraDetailPanel}. */
export interface CameraDetailPanelProps {
  /** The selected camera's loading state; `idle` renders nothing. */
  detail: CameraDetailState;
  /** Called when the visitor closes the panel. */
  onClose: () => void;
}

/**
 * Formats the current time in `timeZone`, or returns `null` if the zone is
 * unknown to this browser.
 */
function formatLocalTime(timeZone: string, now: Date): string | null {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeStyle: 'short',
      timeZone,
    }).format(now);
  } catch {
    // RangeError: the browser doesn't recognize this time zone name.
    return null;
  }
}

/** Shows a camera's local time, refreshed every half minute. */
function LocalTime({timeZone}: {timeZone: string}): React.JSX.Element | null {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, LOCAL_TIME_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  const formatted = formatLocalTime(timeZone, now);
  return formatted === null ? null : <>{formatted}</>;
}

/**
 * Formats coordinates as "35.6762° N, 139.6503° E".
 *
 * @param lat Latitude in degrees.
 * @param lng Longitude in degrees.
 */
export function formatCoordinates(lat: number, lng: number): string {
  const latitude = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}`;
  const longitude = `${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'}`;
  return `${latitude}, ${longitude}`;
}

/** The body of the panel once the camera has loaded. */
function CameraDetails({camera}: {camera: CameraDetail}): React.JSX.Element {
  const style = CATEGORY_STYLES[camera.category];
  const place = formatPlace(camera.placeName, camera.countryCode);

  return (
    <>
      {place !== '' && <p className="text-sm text-muted-foreground">{place}</p>}

      <CameraPreview camera={camera} />

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Category</dt>
        <dd className="flex items-center gap-2">
          <span
            className="size-2.5 rounded-full"
            style={{backgroundColor: style.color}}
            aria-hidden="true"
          />
          {style.label}
        </dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd>{camera.status === 'online' ? 'Online' : 'Offline'}</dd>
        {camera.timeZone !== null && (
          <>
            <dt className="text-muted-foreground">Local time</dt>
            <dd>
              <LocalTime timeZone={camera.timeZone} />
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">Location</dt>
        <dd className="tabular-nums">
          {formatCoordinates(camera.lat, camera.lng)}
        </dd>
      </dl>

      <div className="mt-4 border-t border-panel-border pt-3 text-xs text-muted-foreground">
        <p>
          Source:{' '}
          <span className="text-foreground">
            {camera.attribution.sourceName}
          </span>{' '}
          · {camera.attribution.licenseName}
        </p>
        <p className="mt-1">{camera.attribution.attributionText}</p>
        {camera.attribution.homepageUrl !== null && (
          <a
            href={camera.attribution.homepageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
          >
            Visit source
            <ExternalLink className="size-3" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
      </div>
    </>
  );
}

/**
 * Panel with the selected camera's details and its loading, not-found, and
 * error states.
 *
 * @example
 * <CameraDetailPanel detail={detail} onClose={() => setCameraId(null)} />
 */
export function CameraDetailPanel({
  detail,
  onClose,
}: CameraDetailPanelProps): React.JSX.Element | null {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isOpen = detail.status !== 'idle';
  const titleKey = detail.status === 'ready' ? detail.camera.id : detail.status;

  // Close on Escape while open.
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        onClose();
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen, onClose]);

  // Move focus to the title when the panel opens, and back when it closes.
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const previouslyFocused = document.activeElement;
    headingRef.current?.focus();
    return () => {
      if (
        previouslyFocused instanceof HTMLElement &&
        previouslyFocused.isConnected
      ) {
        previouslyFocused.focus();
      }
    };
  }, [isOpen]);

  // Keep focus on the title as the content changes from loading to loaded.
  useEffect(() => {
    if (isOpen && document.activeElement === document.body) {
      headingRef.current?.focus();
    }
  }, [isOpen, titleKey]);

  if (!isOpen) {
    return null;
  }

  let title: string;
  if (detail.status === 'ready') {
    title = detail.camera.title;
  } else if (detail.status === 'not-found') {
    title = "This camera isn't available";
  } else if (detail.status === 'error') {
    title = "Couldn't load this camera";
  } else {
    title = 'Loading camera…';
  }

  return (
    <aside
      aria-labelledby="camera-detail-title"
      aria-busy={detail.status === 'loading'}
      className={cn(
        'pointer-events-auto absolute overflow-y-auto border border-panel-border bg-panel p-5 backdrop-blur-md',
        // Phones: bottom sheet. Wide screens: panel on the right.
        'inset-x-0 bottom-0 rounded-t-2xl',
        BOTTOM_SHEET_HEIGHT_CLASS,
        'md:inset-x-auto md:top-4 md:right-4 md:bottom-auto md:h-auto md:max-h-[calc(100dvh-2rem)] md:w-96 md:rounded-2xl',
      )}
    >
      <div className="flex items-start gap-2">
        <h2
          id="camera-detail-title"
          ref={headingRef}
          tabIndex={-1}
          className="flex-1 text-lg leading-snug font-semibold focus:outline-none"
        >
          {title}
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close camera details"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </Button>
      </div>

      {detail.status === 'loading' && (
        <p role="status" className="sr-only">
          Loading camera details
        </p>
      )}
      {detail.status === 'not-found' && (
        <p className="mt-2 text-sm text-muted-foreground">
          It may have been removed, or the link may be wrong.
        </p>
      )}
      {detail.status === 'error' && (
        <p role="alert" className="mt-2 text-sm text-muted-foreground">
          Check your connection and try again.
        </p>
      )}
      {detail.status === 'ready' && <CameraDetails camera={detail.camera} />}
    </aside>
  );
}
