/**
 * @fileoverview The parts of satellite.js the orbit worker uses, and only those.
 *
 * Layer: client feature (browser only). Imported by `orbit_worker.ts`.
 *
 * satellite.js's main entry also exports a WebAssembly bulk propagator that
 * starts its own threaded workers. Importing the main entry makes the build
 * try to bundle those, and they would need `'wasm-unsafe-eval'` in our
 * Content Security Policy. The package exposes no smaller entry, so this
 * module imports the three plain-JavaScript modules we need directly from
 * the installed package (pinned in `package.json`): reading OMM records,
 * SGP4 propagation, and coordinate transforms. A satellite.js upgrade must
 * check these paths still exist; the build fails if they don't.
 */
export {json2satrec} from '../../../../node_modules/satellite.js/dist/io.js';
export {
  gstime,
  propagate,
} from '../../../../node_modules/satellite.js/dist/propagation.js';
export {
  degreesLat,
  degreesLong,
  eciToGeodetic,
} from '../../../../node_modules/satellite.js/dist/transforms.js';
export type {OMMJsonObject} from '../../../../node_modules/satellite.js/dist/common-types.js';
export type {SatRec} from '../../../../node_modules/satellite.js/dist/propagation/SatRec.js';
