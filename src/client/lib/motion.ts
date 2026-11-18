/**
 * @fileoverview Respecting the visitor's reduced-motion setting.
 *
 * Layer: client library (browser only).
 *
 * People who get motion sickness can ask their operating system to reduce
 * motion. Camera flights over the globe are large, fast movements, so they
 * become instant jumps for those visitors.
 */

/**
 * Whether the visitor has asked for reduced motion.
 *
 * @returns True if `prefers-reduced-motion: reduce` matches.
 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
