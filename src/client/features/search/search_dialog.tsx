/**
 * @fileoverview Camera search: the search button, the Ctrl K / ⌘K shortcut, and the dialog.
 *
 * Layer: client feature (browser only). The app shell renders the dialog
 * and passes the button into the top bar.
 *
 * The dialog is a combobox: typing searches cameras by name, place, or
 * category (see `use_camera_search.ts`), arrow keys move through the results,
 * and Enter or a click opens the chosen camera. The results list is also the
 * accessible, text-based way to find cameras without using the 3D globe.
 *
 * Keyboard details:
 * - Ctrl K (⌘K on Apple devices) opens the dialog from anywhere.
 * - Escape closes only the dialog. It doesn't reach the camera panel's own
 *   Escape handling underneath.
 * - After a result is chosen, focus is left for the camera panel to claim,
 *   rather than returning to the search button.
 */
import {Search} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';

import {Button} from '@/client/components/ui/button';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/client/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/client/components/ui/dialog';
import {CATEGORY_STYLES} from '@/client/features/cameras';
import {formatPlace} from '@/client/lib/format';
import {isApplePlatform} from '@/client/lib/platform';
import {cn} from '@/client/lib/utils';
import {MAX_SEARCH_QUERY_LENGTH} from '@/shared/cameras';

import {MIN_SEARCH_LENGTH, useCameraSearch} from './use_camera_search';

/**
 * Opens search when Ctrl K or ⌘K is pressed anywhere on the page.
 *
 * @param onOpen Called when the shortcut is pressed.
 */
export function useSearchShortcut(onOpen: () => void): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        // Stop the browser's own Ctrl K (focus the address bar's search).
        event.preventDefault();
        onOpen();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onOpen]);
}

/** Props for {@link SearchTrigger}. */
export interface SearchTriggerProps {
  /** Opens the search dialog. */
  onOpen: () => void;
  /** Extra classes for positioning. */
  className?: string;
}

/**
 * The search button in the top bar, labelled with its keyboard shortcut.
 *
 * @example
 * <SearchTrigger onOpen={() => setSearchOpen(true)} />
 */
export function SearchTrigger({
  onOpen,
  className,
}: SearchTriggerProps): React.JSX.Element {
  // The label only; Ctrl and ⌘ both work everywhere.
  const shortcut = isApplePlatform() ? '⌘K' : 'Ctrl K';
  return (
    <Button
      variant="outline"
      onClick={onOpen}
      aria-keyshortcuts="Control+K Meta+K"
      className={cn(
        'h-11 gap-3 rounded-xl border-panel-border bg-panel px-4 text-muted-foreground backdrop-blur-md hover:text-foreground',
        className,
      )}
    >
      <Search aria-hidden="true" />
      <span className="max-sm:sr-only">Search places and cameras</span>
      <kbd
        className="rounded border border-panel-border px-1.5 text-xs font-medium max-sm:hidden"
        aria-hidden="true"
      >
        {shortcut}
      </kbd>
    </Button>
  );
}

/** Props for {@link SearchDialog}. */
export interface SearchDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Called to open or close it (Escape, clicking outside, choosing a result). */
  onOpenChange: (open: boolean) => void;
  /** Called with the chosen camera's ID. */
  onSelectCamera: (cameraId: string) => void;
}

/**
 * The search dialog: a search box and the matching cameras.
 *
 * @example
 * <SearchDialog open={open} onOpenChange={setOpen} onSelectCamera={setCameraId} />
 */
export function SearchDialog({
  open,
  onOpenChange,
  onSelectCamera,
}: SearchDialogProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const search = useCameraSearch(query);
  // Set when a result was chosen, so closing doesn't move focus back to the
  // search button (the camera panel takes it instead).
  const choseResultRef = useRef(false);

  /** Opens the chosen camera and closes the dialog. */
  const choose = (cameraId: string): void => {
    choseResultRef.current = true;
    onSelectCamera(cameraId);
    onOpenChange(false);
    setQuery('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[15%] translate-y-0 overflow-hidden border-panel-border bg-background p-0 sm:max-w-xl"
        onKeyDown={event => {
          // Keep Escape inside the dialog; see the file header.
          if (event.key === 'Escape') {
            event.stopPropagation();
          }
        }}
        onCloseAutoFocus={event => {
          if (choseResultRef.current) {
            event.preventDefault();
            choseResultRef.current = false;
          }
        }}
      >
        <DialogTitle className="sr-only">Search cameras</DialogTitle>
        <DialogDescription className="sr-only">
          Type a city, place, or camera name, then choose a result to open it.
        </DialogDescription>
        {/* Results come from the server already ranked, so the list's own
            filtering is turned off. */}
        <Command shouldFilter={false} label="Search cameras">
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search a city, place, or camera…"
            maxLength={MAX_SEARCH_QUERY_LENGTH}
          />
          <CommandList className="max-h-[60vh]">
            <SearchStatus search={search} query={query.trim()} />
            {search.status === 'ready' && search.results.length > 0 && (
              <CommandGroup heading="Cameras">
                {search.results.map(result => {
                  const style = CATEGORY_STYLES[result.category];
                  const place = formatPlace(
                    result.placeName,
                    result.countryCode,
                  );
                  return (
                    <CommandItem
                      key={result.id}
                      value={result.id}
                      onSelect={() => {
                        choose(result.id);
                      }}
                      className="gap-3"
                    >
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{backgroundColor: style.color}}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{result.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[place, style.label]
                            .filter(part => part !== '')
                            .join(' · ')}
                        </span>
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/** The message under the search box for every state except a result list. */
function SearchStatus({
  search,
  query,
}: {
  search: ReturnType<typeof useCameraSearch>;
  query: string;
}): React.JSX.Element | null {
  let message: string | null = null;
  switch (search.status) {
    case 'idle':
      message =
        query.length === 0
          ? 'Type a city, place, or camera name.'
          : `Keep typing: at least ${MIN_SEARCH_LENGTH} characters.`;
      break;
    case 'loading':
      message = 'Searching…';
      break;
    case 'ready':
      message =
        search.results.length === 0 ? `No cameras match “${query}”.` : null;
      break;
    case 'rate-limited':
      message = 'Too many searches. Wait a minute and try again.';
      break;
    case 'error':
      message = "Search isn't working right now. Try again soon.";
      break;
  }
  if (message === null) {
    return null;
  }
  return (
    <p
      role="status"
      className="px-4 py-6 text-center text-sm text-muted-foreground"
    >
      {message}
    </p>
  );
}
