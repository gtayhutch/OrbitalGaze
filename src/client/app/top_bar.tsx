/**
 * @fileoverview The bar across the top of the screen.
 *
 * Layer: client app shell (browser only).
 *
 * Holds the OrbitalGaze brand, the environment badge, and the search and
 * share buttons (passed in by the app shell). The account menu will join them later. The
 * bar floats over the globe, and only its contents capture the pointer, so
 * the globe stays draggable underneath the empty parts.
 *
 * Everything sits on the left so the camera panel, which opens on the right,
 * never covers it.
 */
import {Globe2} from 'lucide-react';
import type {ReactNode} from 'react';

import type {AppEnvironment} from '@/shared/app_environment';

import {EnvironmentBadge} from './environment_badge';

/** Props for {@link TopBar}. */
export interface TopBarProps {
  /** The current environment, for the badge. */
  environment: AppEnvironment | undefined;
  /** The search button. */
  search?: ReactNode;
  /** The "Share this view" button. */
  share?: ReactNode;
}

/**
 * Top bar with the brand, environment badge, and search.
 *
 * @example
 * <TopBar environment="test" search={<SearchTrigger onOpen={openSearch} />} />
 */
export function TopBar({
  environment,
  search,
  share,
}: TopBarProps): React.JSX.Element {
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-3 p-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-panel-border bg-panel px-4 py-2 backdrop-blur-md">
        <Globe2 className="size-7 text-primary" aria-hidden="true" />
        <div>
          <h1 className="text-lg leading-tight font-semibold">OrbitalGaze</h1>
          <p className="text-xs text-muted-foreground max-sm:hidden">
            See the world live
          </p>
        </div>
      </div>
      <div className="pointer-events-auto">
        <EnvironmentBadge environment={environment} />
      </div>
      {search !== undefined && (
        <div className="pointer-events-auto">{search}</div>
      )}
      {share !== undefined && (
        <div className="pointer-events-auto">{share}</div>
      )}
    </header>
  );
}
