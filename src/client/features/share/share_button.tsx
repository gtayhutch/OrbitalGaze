/**
 * @fileoverview "Share this view": copies a link to what's on screen.
 *
 * Layer: client feature (browser only). Rendered in the top bar.
 *
 * The link holds the globe's view, the active layers, and the selected
 * camera, so whoever opens it sees the same thing. Clicking the button
 * copies the link and says "Link copied" through a polite live region, so
 * screen readers announce it too. If the browser refuses clipboard access
 * (an older browser, or a permission prompt the visitor declined), the
 * link appears in a text field, already selected, ready to copy by hand.
 */
import {Check, Link as LinkIcon, X} from 'lucide-react';
import {useEffect, useId, useRef, useState} from 'react';

import {Button} from '@/client/components/ui/button';
import {cn} from '@/client/lib/utils';

/** How long "Link copied" stays on screen, in milliseconds. */
const COPIED_MESSAGE_MS = 3_000;

/** Props for {@link ShareButton}. */
export interface ShareButtonProps {
  /** Builds the link for the current view, at the moment of the click. */
  getShareUrl: () => string;
  /** Extra classes. */
  className?: string;
}

/** What the button is showing. */
type ShareState =
  | {readonly kind: 'idle'}
  | {readonly kind: 'copied'}
  | {readonly kind: 'manual'; readonly url: string};

/**
 * Button that copies a link to the current view.
 *
 * @example
 * <ShareButton getShareUrl={() => buildShareUrl(window.location.href, layers)} />
 */
export function ShareButton({
  getShareUrl,
  className,
}: ShareButtonProps): React.JSX.Element {
  const [state, setState] = useState<ShareState>({kind: 'idle'});
  const fieldId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);

  // Clear "Link copied" after a few seconds.
  useEffect(() => {
    if (state.kind !== 'copied') {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setState({kind: 'idle'});
    }, COPIED_MESSAGE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [state]);

  // Focus and select the link in the fallback field so it's ready to copy.
  useEffect(() => {
    if (state.kind === 'manual') {
      fieldRef.current?.focus();
      fieldRef.current?.select();
    }
  }, [state]);

  const share = async (): Promise<void> => {
    const url = getShareUrl();
    try {
      await navigator.clipboard.writeText(url);
      setState({kind: 'copied'});
    } catch {
      setState({kind: 'manual', url});
    }
  };

  return (
    <div className={cn('relative', className)}>
      <Button
        variant="outline"
        onClick={() => {
          void share();
        }}
        className="h-11 gap-2 rounded-xl border-panel-border bg-panel px-4 text-muted-foreground backdrop-blur-md hover:text-foreground"
      >
        {state.kind === 'copied' ? (
          <Check className="text-primary" aria-hidden="true" />
        ) : (
          <LinkIcon aria-hidden="true" />
        )}
        <span className="max-sm:sr-only">Share this view</span>
      </Button>

      {/* Announced by screen readers; also shown on screen. */}
      <p
        role="status"
        className="absolute top-full left-0 mt-1 text-xs whitespace-nowrap text-foreground"
      >
        {state.kind === 'copied' ? 'Link copied' : ''}
      </p>

      {state.kind === 'manual' && (
        <div className="absolute top-full left-0 z-20 mt-2 w-72 rounded-xl border border-panel-border bg-panel p-3 text-sm backdrop-blur-md">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={fieldId} className="font-medium">
              Copy this link
            </label>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close"
              className="size-7"
              onClick={() => {
                setState({kind: 'idle'});
              }}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
          <input
            id={fieldId}
            ref={fieldRef}
            readOnly
            value={state.url}
            onFocus={event => {
              event.currentTarget.select();
            }}
            className="mt-2 w-full rounded-md border border-panel-border bg-background px-2 py-1 text-xs"
          />
        </div>
      )}
    </div>
  );
}
