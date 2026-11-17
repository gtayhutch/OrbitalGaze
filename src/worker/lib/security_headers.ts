/**
 * @fileoverview Security headers for every API response.
 *
 * Layer: worker library (server only).
 *
 * Static files (the app's HTML, scripts, and Cesium assets) get their headers
 * from `public/_headers`. API responses come from Worker code instead, so they
 * get theirs from this middleware. API responses are JSON and never render as
 * pages, so their Content Security Policy forbids everything.
 */
import type {MiddlewareHandler} from 'hono';
import {secureHeaders} from 'hono/secure-headers';

/**
 * Middleware that sets the API's security headers.
 *
 * What each setting does:
 * - Content-Security-Policy `default-src 'none'`: a JSON response can't load
 *   or run anything, even if a browser is tricked into rendering it.
 * - `frame-ancestors 'none'` and X-Frame-Options `DENY`: no other site can
 *   embed API responses in a frame.
 * - X-Content-Type-Options `nosniff` (on by default): browsers must trust the
 *   declared content type instead of guessing.
 * - Referrer-Policy: only our origin, never full URLs, is sent to other sites.
 * - Cross-Origin-Opener-Policy and Cross-Origin-Resource-Policy `same-origin`:
 *   isolate our responses from other sites' windows and pages.
 * - Permissions-Policy: deny powerful browser features the app doesn't use.
 *
 * Strict-Transport-Security is off for now. It will be turned on for
 * production once the domain is confirmed to serve HTTPS only, because
 * sending it early can lock visitors out of a misconfigured domain for the
 * whole max-age.
 */
export const apiSecurityHeaders: MiddlewareHandler = secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'none'"],
    frameAncestors: ["'none'"],
  },
  xFrameOptions: 'DENY',
  referrerPolicy: 'strict-origin-when-cross-origin',
  crossOriginOpenerPolicy: 'same-origin',
  crossOriginResourcePolicy: 'same-origin',
  strictTransportSecurity: false,
  permissionsPolicy: {
    camera: [],
    microphone: [],
    geolocation: [],
    payment: [],
    usb: [],
  },
});
