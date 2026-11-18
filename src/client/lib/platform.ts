/**
 * @fileoverview Facts about the visitor's device that change what we display.
 *
 * Layer: client library (browser only).
 */

/**
 * Whether the visitor is on a Mac, iPhone, or iPad, where keyboard shortcuts
 * use ⌘ (Command) instead of Ctrl.
 *
 * Detection uses the user-agent string, which is good enough for choosing a
 * label. Both ⌘ and Ctrl work for the shortcut itself on every platform.
 *
 * @returns True on Apple platforms.
 */
export function isApplePlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(window.navigator.userAgent);
}
