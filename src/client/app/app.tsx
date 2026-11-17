/**
 * @fileoverview The app shell: the globe with the interface layered on top.
 *
 * Layer: client app shell (browser only). Rendered by `main.tsx`.
 *
 * The globe fills the whole window. Interface panels float above it in
 * absolutely positioned layers. Everything is wrapped in an error boundary so
 * a failure shows a recovery screen instead of a blank page.
 *
 * The globe is loaded lazily: CesiumJS is several megabytes, so the shell
 * (brand, panels) appears first and the globe streams in behind it.
 */
import {lazy, Suspense} from 'react';

import {AppErrorBoundary} from './app_error_boundary';
import {TopBar} from './top_bar';
import {useAppEnvironment} from './use_app_environment';

/** The globe component, fetched as a separate bundle on first render. */
const GlobeView = lazy(async () => {
  const globeFeature = await import('@/client/features/globe');
  return {default: globeFeature.GlobeView};
});

/**
 * The root component of the browser app.
 *
 * @example
 * createRoot(element).render(<App />);
 */
export function App(): React.JSX.Element {
  const environment = useAppEnvironment();
  return (
    <AppErrorBoundary>
      <div className="relative h-dvh w-full overflow-hidden bg-background text-foreground">
        <Suspense
          fallback={
            <p
              role="status"
              className="absolute inset-x-0 bottom-24 text-center text-sm text-muted-foreground"
            >
              Loading the globe…
            </p>
          }
        >
          <GlobeView className="absolute inset-0" />
        </Suspense>
        <TopBar environment={environment} />
      </div>
    </AppErrorBoundary>
  );
}
