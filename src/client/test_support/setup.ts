/**
 * @fileoverview Test setup for browser-app tests.
 *
 * Layer: client test support (runs in jsdom during `pnpm test` only).
 *
 * Adds DOM matchers such as `toBeInTheDocument()` and unmounts rendered
 * components after each test so tests don't affect each other.
 */
import '@testing-library/jest-dom/vitest';

import {cleanup} from '@testing-library/react';
import {afterEach} from 'vitest';

afterEach(() => {
  cleanup();
});
