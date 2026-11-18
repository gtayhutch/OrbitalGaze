/**
 * @fileoverview Build plugin that removes the one `eval` call in Cesium.
 *
 * Layer: build tooling (Node.js). Used by `vite.config.ts`.
 *
 * Cesium's widgets include Knockout 3.5.1, which finds the global object
 * with `this || (0,eval)("this")`. Cesium's code runs as an ES module, where
 * `this` is undefined, so the `eval` always runs. Our Content Security Policy
 * doesn't allow string evaluation:
 * - while the policy is report-only, the call files a violation report on
 *   every page load;
 * - once it's enforced, the call would throw while Cesium loads.
 *
 * `globalThis` is the standard name for the same object, so the plugin swaps
 * it in at build time. If a Cesium upgrade changes this code, the build
 * fails here instead of quietly shipping the `eval` again. The end-to-end
 * test "loading the globe never evaluates strings as code" checks the result.
 *
 * Only builds are patched. The dev server pre-bundles Cesium separately and
 * doesn't send our security headers.
 */
import type {Plugin} from 'vite';

/** Matches Knockout inside the `@cesium/widgets` package, on any OS. */
const KNOCKOUT_FILE =
  /[\\/]@cesium[\\/]widgets[\\/]Source[\\/]ThirdParty[\\/]knockout-[\d.]+\.js$/;

/** The exact expression Knockout uses to find the global object. */
const GLOBAL_LOOKUP_WITH_EVAL = '(0,eval)("this")';

/**
 * Replaces Knockout's `eval`-based global lookup with `globalThis`.
 *
 * @param code The file's source.
 * @returns The source without the `eval` call.
 * @throws {Error} When the expected expression isn't there, which means
 *     Cesium changed the file and this patch needs another look.
 * @example
 * removeKnockoutEval('var A=this||(0,eval)("this");');
 * // 'var A=this||globalThis;'
 */
export function removeKnockoutEval(code: string): string {
  if (!code.includes(GLOBAL_LOOKUP_WITH_EVAL)) {
    throw new Error(
      `Cesium's Knockout no longer contains ${GLOBAL_LOOKUP_WITH_EVAL}. ` +
        'Check whether it still uses eval, then update scripts/cesium_no_eval_plugin.ts.',
    );
  }
  return code.replaceAll(GLOBAL_LOOKUP_WITH_EVAL, 'globalThis');
}

/**
 * Creates the Vite plugin that applies {@link removeKnockoutEval} to
 * Cesium's Knockout file during a build.
 *
 * @returns The plugin.
 * @example
 * // In vite.config.ts:
 * plugins: [react(), cesiumNoEval()],
 */
export function cesiumNoEval(): Plugin {
  return {
    name: 'orbitalgaze:cesium-no-eval',
    apply: 'build',
    transform(code, id) {
      // Module IDs can carry a query string; match on the file path alone.
      const [path = id] = id.split('?');
      if (!KNOCKOUT_FILE.test(path)) {
        return null;
      }
      return {code: removeKnockoutEval(code), map: null};
    },
  };
}
