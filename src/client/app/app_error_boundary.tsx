/**
 * @fileoverview Last-resort error screen for the whole app.
 *
 * Layer: client app shell (browser only).
 *
 * If any component throws while rendering, React unmounts the whole tree.
 * This boundary catches that and shows a friendly message with a reload
 * button instead of a blank page. It reports through the browser diagnostics
 * module when monitoring is configured.
 *
 * React only supports error boundaries as class components, which is why this
 * is a class while every other component is a function.
 */
import {Component, type ErrorInfo, type ReactNode} from 'react';

import {Button} from '@/client/components/ui/button';
import {reportBrowserError} from '@/client/lib/error_reporting';

/** Props for {@link AppErrorBoundary}. */
export interface AppErrorBoundaryProps {
  /** The app to protect. */
  children: ReactNode;
}

/** Whether a render error has been caught. */
interface AppErrorBoundaryState {
  hasError: boolean;
}

/**
 * Shows a recovery screen when anything below it fails to render.
 *
 * @example
 * <AppErrorBoundary><App /></AppErrorBoundary>
 */
export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  override state: AppErrorBoundaryState = {hasError: false};

  /** Switches to the error screen on the next render. */
  static getDerivedStateFromError(): AppErrorBoundaryState {
    return {hasError: true};
  }

  /** Records the failure for debugging. */
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('The app failed to render.', error, info.componentStack);
    reportBrowserError('browser.app-render', error);
  }

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <main role="alert" className="grid h-full place-items-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            OrbitalGaze hit an unexpected problem. Reloading the page usually
            fixes it.
          </p>
          <Button
            className="mt-4"
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload
          </Button>
        </div>
      </main>
    );
  }
}
