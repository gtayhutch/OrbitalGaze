/**
 * @fileoverview Fills the local database with synthetic cameras.
 *
 * Layer: tooling (runs in Node.js, never deployed).
 *
 * Usage: `pnpm db:seed` (applies migrations first, then this script).
 *
 * The cameras are made up: invented names at points near real cities, so the
 * globe has something realistic to show during development. They have no
 * feeds. Real camera data never comes from production into local or staging
 * databases; those environments always use this generated data instead.
 *
 * The output is the same every run, because the "random" numbers come from a
 * fixed seed. Re-running replaces the previous synthetic rows.
 */
import {execFileSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

/** How many synthetic cameras to create. */
const CAMERA_COUNT = 500;

/** Fixed seed so every run produces the same cameras. */
const RANDOM_SEED = 20261117;

/**
 * How far, in degrees, a camera may sit from its anchor city. About 1.5° is
 * roughly 165 km at the equator: close enough to cluster around the city.
 */
const MAX_OFFSET_DEGREES = 1.5;

/** Where the generated SQL is written (inside the git-ignored .wrangler folder). */
const OUTPUT_DIRECTORY = '.wrangler/seed';

/** Categories, matching the CHECK constraint in migrations/0001_init.sql. */
const CATEGORIES = [
  'city',
  'nature',
  'traffic',
  'weather',
  'landmark',
  'beach',
] as const;

/** A real city the synthetic cameras cluster around. */
interface AnchorCity {
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
}

/** Anchor cities spread across every inhabited continent. */
const ANCHOR_CITIES: readonly AnchorCity[] = [
  {name: 'New York', latitude: 40.7128, longitude: -74.006},
  {name: 'Los Angeles', latitude: 34.0522, longitude: -118.2437},
  {name: 'Mexico City', latitude: 19.4326, longitude: -99.1332},
  {name: 'São Paulo', latitude: -23.5505, longitude: -46.6333},
  {name: 'Reykjavík', latitude: 64.1466, longitude: -21.9426},
  {name: 'London', latitude: 51.5072, longitude: -0.1276},
  {name: 'Paris', latitude: 48.8566, longitude: 2.3522},
  {name: 'Cape Town', latitude: -33.9249, longitude: 18.4241},
  {name: 'Nairobi', latitude: -1.2921, longitude: 36.8219},
  {name: 'Dubai', latitude: 25.2048, longitude: 55.2708},
  {name: 'Mumbai', latitude: 19.076, longitude: 72.8777},
  {name: 'Tokyo', latitude: 35.6762, longitude: 139.6503},
  {name: 'Sydney', latitude: -33.8688, longitude: 151.2093},
  {name: 'Auckland', latitude: -36.8485, longitude: 174.7633},
  {name: 'Anchorage', latitude: 61.2176, longitude: -149.8997},
];

/**
 * Creates a small, fast, seeded random number generator (Mulberry32).
 *
 * Not suitable for anything security-related; it exists only to make the
 * synthetic data reproducible.
 *
 * @param seed Any 32-bit integer.
 * @returns A function that returns a number in [0, 1) on each call.
 */
function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // Mulberry32: advance the state by a fixed odd constant, then scramble
    // the bits with multiplications and shifts.
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Escapes a value for use inside a single-quoted SQL string literal.
 *
 * @param value The text to embed.
 * @returns The text with each `'` doubled, as SQLite requires.
 */
function escapeSqlText(value: string): string {
  return value.replaceAll("'", "''");
}

/**
 * Picks one element from a non-empty list.
 *
 * @throws {Error} If the list is empty.
 */
function pick<T>(items: readonly T[], random: () => number): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) {
    throw new Error('Cannot pick from an empty list.');
  }
  return item;
}

/**
 * Builds the SQL that replaces every synthetic camera.
 *
 * @returns A SQL script: one DELETE, then one INSERT per camera.
 */
function buildSeedSql(): string {
  const random = createSeededRandom(RANDOM_SEED);
  const statements = ["DELETE FROM cameras WHERE id LIKE 'seed-%';"];

  for (let index = 0; index < CAMERA_COUNT; index++) {
    const city = pick(ANCHOR_CITIES, random);
    const category = pick(CATEGORIES, random);
    // Offset each camera from its city by up to MAX_OFFSET_DEGREES each way.
    const latitude = city.latitude + (random() * 2 - 1) * MAX_OFFSET_DEGREES;
    const longitude = city.longitude + (random() * 2 - 1) * MAX_OFFSET_DEGREES;
    // Seed IDs start with "seed-" so they're easy to recognize and replace.
    const id = `seed-${String(index).padStart(4, '0')}`;
    const name = escapeSqlText(`${city.name} ${category} camera ${index + 1}`);

    statements.push(
      'INSERT INTO cameras (id, name, latitude, longitude, category) VALUES ' +
        `('${id}', '${name}', ${latitude.toFixed(5)}, ${longitude.toFixed(5)}, '${category}');`,
    );
  }
  return statements.join('\n') + '\n';
}

/** Writes the SQL file and runs it against the local database. */
function main(): void {
  mkdirSync(OUTPUT_DIRECTORY, {recursive: true});
  const sqlPath = join(OUTPUT_DIRECTORY, 'cameras.sql');
  writeFileSync(sqlPath, buildSeedSql());

  // `--local` targets the Miniflare database on this machine only.
  execFileSync(
    'pnpm',
    ['exec', 'wrangler', 'd1', 'execute', 'DB', '--local', `--file=${sqlPath}`],
    {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    },
  );
  console.log(`Seeded ${CAMERA_COUNT} synthetic cameras.`);
}

main();
