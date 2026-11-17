/**
 * @fileoverview Browser entry point: mounts the React app into the page.
 *
 * Layer: client (browser only). Loaded by index.html.
 *
 * StrictMode is on, so in development React mounts components twice to expose
 * effects that don't clean up after themselves. The globe component is
 * written to handle that.
 */
import './index.css';

import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';

import {App} from './app/app';

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
