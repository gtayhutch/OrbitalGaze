/**
 * @fileoverview Puts a basemap archive into the local R2 bucket.
 *
 * Layer: tooling (runs in Node.js, never deployed).
 *
 * Usage:
 * - `pnpm basemap:seed`: writes a tiny synthetic archive (zoom 0–2, every
 *   tile plain land), so the globe, its tests and a fresh checkout have
 *   tiles to load. No map data is involved.
 * - `pnpm basemap:seed path/to/area.pmtiles`: uploads a real PMTiles
 *   archive instead, to see the real map while developing. Make one with the
 *   `pmtiles` command-line tool, for example
 *   `pmtiles extract https://build.protomaps.com/20261118.pmtiles area.pmtiles --bbox=-10,35,30,60 --maxzoom=10`.
 *
 * Either way the archive lands at the key the local Worker reads
 * (`BASEMAP_ARCHIVE` in `wrangler.jsonc`, `planet/local.pmtiles`) in the
 * local bucket only. Hosted buckets are never touched.
 */
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

import {buildPmtilesArchive} from '../src/worker/test_support/pmtiles_writer.ts';

/** The local bucket and key the Worker reads (see `wrangler.jsonc`). */
const LOCAL_BUCKET = 'orbitalgaze-basemap-local';
const LOCAL_ARCHIVE_KEY = 'planet/local.pmtiles';

/** Deepest zoom of the synthetic archive (21 tiles in all). */
const SYNTHETIC_MAX_ZOOM = 2;

/** Where the synthetic archive is written (inside the git-ignored .wrangler folder). */
const OUTPUT_DIRECTORY = '.wrangler/seed';

/** Wrangler's command-line entry point inside node_modules. */
const WRANGLER_SCRIPT = 'node_modules/wrangler/bin/wrangler.js';

/** Size of a vector tile's coordinate grid. */
const TILE_EXTENT = 4096;

/** Appends `value` as a protobuf varint. */
function pushVarint(out: number[], value: number): void {
  let remaining = value;
  while (remaining >= 0x80) {
    out.push((remaining % 0x80) | 0x80);
    remaining = Math.floor(remaining / 0x80);
  }
  out.push(remaining);
}

/** Appends a length-delimited protobuf field. */
function pushBytes(
  out: number[],
  field: number,
  bytes: readonly number[],
): void {
  pushVarint(out, (field << 3) | 2);
  pushVarint(out, bytes.length);
  out.push(...bytes);
}

/** Zig-zag encodes a signed integer, as vector tile geometry requires. */
function zigZag(value: number): number {
  return value >= 0 ? value * 2 : -value * 2 - 1;
}

/**
 * Encodes a Mapbox vector tile with one `earth` layer holding one square
 * polygon over the whole tile (the format's wire layout, written by hand to
 * avoid a dependency for a test fixture).
 */
function plainLandTile(): Uint8Array {
  // Geometry: move to the top-left corner, draw three edges clockwise, close.
  const moveTo = (1 & 0x7) | (1 << 3);
  const lineTo3 = (2 & 0x7) | (3 << 3);
  const closePath = (7 & 0x7) | (1 << 3);
  const geometry: number[] = [];
  for (const value of [
    moveTo,
    zigZag(0),
    zigZag(0),
    lineTo3,
    zigZag(TILE_EXTENT),
    zigZag(0),
    zigZag(0),
    zigZag(TILE_EXTENT),
    zigZag(-TILE_EXTENT),
    zigZag(0),
    closePath,
  ]) {
    pushVarint(geometry, value);
  }

  // Feature: id 1, type polygon (3), packed geometry.
  const feature: number[] = [];
  pushVarint(feature, (1 << 3) | 0);
  pushVarint(feature, 1);
  pushVarint(feature, (3 << 3) | 0);
  pushVarint(feature, 3);
  pushBytes(feature, 4, geometry);

  // Layer: version 2, name "earth", the feature, extent.
  const layer: number[] = [];
  pushVarint(layer, (15 << 3) | 0);
  pushVarint(layer, 2);
  pushBytes(layer, 1, [...new TextEncoder().encode('earth')]);
  pushBytes(layer, 2, feature);
  pushVarint(layer, (5 << 3) | 0);
  pushVarint(layer, TILE_EXTENT);

  const tile: number[] = [];
  pushBytes(tile, 3, layer);
  return Uint8Array.from(tile);
}

/** Writes the synthetic archive and returns its path. */
function writeSyntheticArchive(): string {
  const data = plainLandTile();
  const tiles = [];
  for (let z = 0; z <= SYNTHETIC_MAX_ZOOM; z += 1) {
    for (let x = 0; x < 2 ** z; x += 1) {
      for (let y = 0; y < 2 ** z; y += 1) {
        tiles.push({z, x, y, data});
      }
    }
  }
  const archive = buildPmtilesArchive({
    tiles,
    metadata: {
      name: 'OrbitalGaze synthetic basemap',
      vector_layers: [{id: 'earth', fields: {}}],
    },
  });
  mkdirSync(OUTPUT_DIRECTORY, {recursive: true});
  const path = join(OUTPUT_DIRECTORY, 'synthetic.pmtiles');
  writeFileSync(path, archive);
  return path;
}

/** Entry point. */
function main(): void {
  const given = process.argv[2];
  if (given !== undefined && !existsSync(given)) {
    throw new Error(`No file at ${given}.`);
  }
  const archivePath =
    given === undefined ? writeSyntheticArchive() : resolve(given);
  execFileSync(
    process.execPath,
    [
      WRANGLER_SCRIPT,
      'r2',
      'object',
      'put',
      `${LOCAL_BUCKET}/${LOCAL_ARCHIVE_KEY}`,
      `--file=${archivePath}`,
      '--local',
    ],
    {stdio: 'inherit'},
  );
  console.log(
    given === undefined
      ? 'Seeded the synthetic basemap (plain land, zoom 0–2).'
      : `Seeded the basemap from ${archivePath}.`,
  );
}

main();
