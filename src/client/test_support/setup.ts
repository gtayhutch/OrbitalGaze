/**
 * @fileoverview Test setup for browser-app tests.
 *
 * Layer: client test support (runs in jsdom during `pnpm test` only).
 *
 * - Adds DOM matchers such as `toBeInTheDocument()`.
 * - Provides `window.matchMedia`, which jsdom lacks. It reports a wide
 *   screen (min-width queries match) and no reduced-motion preference, so
 *   panels render in their desktop layout by default.
 * - Provides inert `ResizeObserver` and `scrollIntoView`, also missing from
 *   jsdom, for the search list.
 * - Gives each test a fresh, empty in-memory `localStorage`.
 * - After each test: unmounts components and resets the URL, so tests don't
 *   affect each other.
 */
import '@testing-library/jest-dom/vitest';

import {cleanup} from '@testing-library/react';
import {afterEach, beforeEach} from 'vitest';

/** A minimal `MediaQueryList` for `query`. */
function fakeMediaQueryList(query: string): MediaQueryList {
  return {
    matches: query.includes('min-width'),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- MediaQueryList still declares this legacy method.
    addListener: () => undefined,
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- MediaQueryList still declares this legacy method.
    removeListener: () => undefined,
    dispatchEvent: () => false,
  };
}

/**
 * An in-memory `Storage`. Recent Node.js versions define their own
 * `localStorage` global, which hides jsdom's, so tests install this one.
 */
class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();

  get length(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

/** A `ResizeObserver` that never reports; jsdom has no layout to observe. */
class InertResizeObserver implements ResizeObserver {
  observe(): void {
    // jsdom has no layout, so there is never anything to report.
  }
  unobserve(): void {
    // Nothing is tracked.
  }
  disconnect(): void {
    // Nothing is tracked.
  }
}

beforeEach(() => {
  window.matchMedia = fakeMediaQueryList;
  // Used by the search list (cmdk) to size itself and keep the highlighted
  // result in view; jsdom provides neither.
  window.ResizeObserver = InertResizeObserver;
  Element.prototype.scrollIntoView = () => undefined;
  Object.defineProperty(window, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});
