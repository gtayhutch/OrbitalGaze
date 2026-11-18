/**
 * @fileoverview Configures Zod for the browser before any schema runs.
 *
 * Layer: client (browser only). Imported first by `main.tsx`, for its side
 * effect, so it runs before any module that parses with Zod.
 *
 * By default Zod checks whether the page allows `new Function`. If it does,
 * Zod compiles a faster parser for each object schema with `new Function`.
 * Our Content Security Policy doesn't allow string evaluation
 * (`script-src` has no `'unsafe-eval'`):
 * - while the policy is report-only, every compiled parser files a
 *   violation report;
 * - once it's enforced, the check fails, and Zod falls back to the plain
 *   parser anyway.
 *
 * `jitless` makes Zod skip both the check and the compiling, so the browser
 * never evaluates strings for us. Our schemas are small, so the slower plain
 * parser costs nothing noticeable.
 */
import {z} from 'zod';

z.config({jitless: true});
