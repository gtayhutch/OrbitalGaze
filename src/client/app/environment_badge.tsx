/**
 * @fileoverview Badge that labels non-production environments.
 *
 * Layer: client app shell (browser only).
 *
 * Shown on every environment except production ("Local", "Staging"), so
 * testers never mistake a test site for the real one. Production shows
 * nothing.
 */
import {Badge} from '@/client/components/ui/badge';
import type {AppEnvironment} from '@/shared/app_environment';

/** Human-readable labels for the environments that show a badge. */
const ENVIRONMENT_LABELS: Readonly<
  Record<Exclude<AppEnvironment, 'production'>, string>
> = {
  test: 'Local',
  staging: 'Staging',
};

/** Props for {@link EnvironmentBadge}. */
export interface EnvironmentBadgeProps {
  /** The current environment, or `undefined` if it isn't known yet. */
  environment: AppEnvironment | undefined;
}

/**
 * Shows the environment name, or nothing in production or while unknown.
 *
 * @example
 * <EnvironmentBadge environment="staging" />
 */
export function EnvironmentBadge({
  environment,
}: EnvironmentBadgeProps): React.JSX.Element | null {
  if (environment === undefined || environment === 'production') {
    return null;
  }
  return (
    <Badge
      className="bg-warning text-warning-foreground"
      aria-label={`Environment: ${ENVIRONMENT_LABELS[environment]}`}
    >
      {ENVIRONMENT_LABELS[environment]}
    </Badge>
  );
}
