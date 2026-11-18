/**
 * @fileoverview Browser entry point: mounts the React app into the page.
 *
 * Layer: client (browser only). Loaded by index.html.
 *
 * StrictMode is on, so in development React mounts components twice to expose
 * effects that don't clean up after themselves. The globe component is
 * written to handle that.
 *
 * `zod_setup` is imported first: modules run in import order, so Zod is
 * configured before any other module can parse with it.
 */
import './lib/zod_setup';
import './index.css';

import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';

import {App} from './app/app';
import {reportBrowserError} from './lib/error_reporting';

// Errors outside React can still prevent the visitor from using the app.
window.addEventListener('error', event => {
  if (event.error instanceof Error) {
    reportBrowserError('browser.unhandled', event.error);
  }
});
window.addEventListener('unhandledrejection', event => {
  reportBrowserError('browser.unhandled', event.reason);
});

const rootElement = document.getElementById('root');
if (rootElement === null) {
  // Only possible if index.html is edited incorrectly.
  throw new Error('Missing #root element in index.html.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
