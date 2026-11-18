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
 * About 5% of the cameras are offline and 5% hidden, so filtering can be
 * seen working. The output is the same every run, because the "random"
 * numbers come from a fixed seed. Re-running replaces the previous synthetic
 * rows (the `synthetic` source and every camera with an ID starting `seed-`).
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

/** Share of cameras marked offline, and share marked hidden. */
const OFFLINE_SHARE = 0.05;
const HIDDEN_SHARE = 0.05;

/** Where the generated SQL is written (inside the git-ignored .wrangler folder). */
const OUTPUT_DIRECTORY = '.wrangler/seed';

/** Wrangler's command-line entry point inside node_modules. */
const WRANGLER_SCRIPT = 'node_modules/wrangler/bin/wrangler.js';

/** ID of the source every synthetic camera belongs to. */
const SYNTHETIC_SOURCE_ID = 'synthetic';

/**
 * Categories, matching the CHECK constraint in the migrations, with the word
 * used in each camera's made-up title.
 */
const CATEGORY_TITLE_WORDS = {
  city: 'skyline',
  nature: 'park',
  traffic: 'highway',
  weather: 'weather station',
  landmark: 'landmark',
  beach: 'beach',
} as const;

/** One of the categories the seed uses. */
type SeedCategory = keyof typeof CATEGORY_TITLE_WORDS;

/** A real city the synthetic cameras cluster around. */
interface AnchorCity {
  readonly name: string;
  readonly countryCode: string;
  readonly timeZone: string;
  readonly lat: number;
  readonly lng: number;
}

/** Anchor cities spread across every inhabited continent. */
const ANCHOR_CITIES: readonly AnchorCity[] = [
  {
    name: 'New York',
    countryCode: 'US',
    timeZone: 'America/New_York',
    lat: 40.7128,
    lng: -74.006,
  },
  {
    name: 'Los Angeles',
    countryCode: 'US',
    timeZone: 'America/Los_Angeles',
    lat: 34.0522,
    lng: -118.2437,
  },
  {
    name: 'Mexico City',
    countryCode: 'MX',
    timeZone: 'America/Mexico_City',
    lat: 19.4326,
    lng: -99.1332,
  },
  {
    name: 'São Paulo',
    countryCode: 'BR',
    timeZone: 'America/Sao_Paulo',
    lat: -23.5505,
    lng: -46.6333,
  },
  {
    name: 'Reykjavík',
    countryCode: 'IS',
    timeZone: 'Atlantic/Reykjavik',
    lat: 64.1466,
    lng: -21.9426,
  },
  {
    name: 'London',
    countryCode: 'GB',
    timeZone: 'Europe/London',
    lat: 51.5072,
    lng: -0.1276,
  },
  {
    name: 'Paris',
    countryCode: 'FR',
    timeZone: 'Europe/Paris',
    lat: 48.8566,
    lng: 2.3522,
  },
  {
    name: 'Cape Town',
    countryCode: 'ZA',
    timeZone: 'Africa/Johannesburg',
    lat: -33.9249,
    lng: 18.4241,
  },
  {
    name: 'Nairobi',
    countryCode: 'KE',
    timeZone: 'Africa/Nairobi',
    lat: -1.2921,
    lng: 36.8219,
  },
  {
    name: 'Dubai',
    countryCode: 'AE',
    timeZone: 'Asia/Dubai',
    lat: 25.2048,
    lng: 55.2708,
  },
  {
    name: 'Mumbai',
    countryCode: 'IN',
    timeZone: 'Asia/Kolkata',
    lat: 19.076,
    lng: 72.8777,
  },
  {
    name: 'Tokyo',
    countryCode: 'JP',
    timeZone: 'Asia/Tokyo',
    lat: 35.6762,
    lng: 139.6503,
  },
  {
    name: 'Sydney',
    countryCode: 'AU',
    timeZone: 'Australia/Sydney',
    lat: -33.8688,
    lng: 151.2093,
  },
  {
    name: 'Auckland',
    countryCode: 'NZ',
    timeZone: 'Pacific/Auckland',
    lat: -36.8485,
    lng: 174.7633,
  },
  {
    name: 'Anchorage',
    countryCode: 'US',
    timeZone: 'America/Anchorage',
    lat: 61.2176,
    lng: -149.8997,
  },
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
 * Formats a value as a SQL literal: text in single quotes (each `'` doubled,
 * as SQLite requires), numbers as written.
 */
function sqlLiteral(value: string | number): string {
  return typeof value === 'number'
    ? String(value)
    : `'${value.replaceAll("'", "''")}'`;
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

/** Chooses a status so that roughly the configured shares are offline or hidden. */
function pickStatus(random: () => number): 'online' | 'offline' | 'hidden' {
  const roll = random();
  if (roll < HIDDEN_SHARE) {
    return 'hidden';
  }
  if (roll < HIDDEN_SHARE + OFFLINE_SHARE) {
    return 'offline';
  }
  return 'online';
}

/**
 * Builds the SQL that replaces every synthetic row.
 *
 * @returns A SQL script: deletes, the source, the cameras, then the matching
 *     search entries.
 */
function buildSeedSql(): string {
  const random = createSeededRandom(RANDOM_SEED);
  const categories = Object.keys(CATEGORY_TITLE_WORDS) as SeedCategory[];

  // Step 1: remove the previous synthetic data (search entries first, since
  // they aren't tied to cameras by a foreign key).
  const statements = [
    "DELETE FROM cameras_fts WHERE cameraId LIKE 'seed-%';",
    `DELETE FROM sources WHERE id = ${sqlLiteral(SYNTHETIC_SOURCE_ID)};`,
    'INSERT INTO sources (id, name, licenseName, attributionText, allowedHosts, commercialUseAllowed) VALUES ' +
      `(${sqlLiteral(SYNTHETIC_SOURCE_ID)}, 'OrbitalGaze test data', 'Synthetic test data', ` +
      "'Made-up camera for development. No real feed.', '[]', 0);",
  ];

  // Step 2: one INSERT per camera.
  for (let index = 0; index < CAMERA_COUNT; index++) {
    const city = pick(ANCHOR_CITIES, random);
    const category = pick(categories, random);
    // Offset each camera from its city by up to MAX_OFFSET_DEGREES each way.
    const lat = city.lat + (random() * 2 - 1) * MAX_OFFSET_DEGREES;
    const lng = city.lng + (random() * 2 - 1) * MAX_OFFSET_DEGREES;
    // Seed IDs start with "seed-" so they're easy to recognize and replace.
    const id = `seed-${String(index + 1).padStart(4, '0')}`;
    const title = `${city.name} ${CATEGORY_TITLE_WORDS[category]} cam ${index + 1}`;

    const values = [
      sqlLiteral(id),
      sqlLiteral(SYNTHETIC_SOURCE_ID),
      sqlLiteral(id),
      sqlLiteral(title),
      lat.toFixed(5),
      lng.toFixed(5),
      sqlLiteral(city.countryCode),
      sqlLiteral(city.name),
      sqlLiteral(city.timeZone),
      sqlLiteral(category),
      sqlLiteral(pickStatus(random)),
    ];
    statements.push(
      'INSERT INTO cameras (id, sourceId, externalId, title, lat, lng, countryCode, placeName, timeZone, category, status) ' +
        `VALUES (${values.join(', ')});`,
    );
  }

  // Step 3: search entries for every synthetic camera, copied in one go.
  statements.push(
    'INSERT INTO cameras_fts (cameraId, title, placeName, category) ' +
      `SELECT id, title, placeName, category FROM cameras WHERE sourceId = ${sqlLiteral(SYNTHETIC_SOURCE_ID)};`,
  );
  return statements.join('\n') + '\n';
}

/** Writes the SQL file and runs it against the local database. */
function main(): void {
  mkdirSync(OUTPUT_DIRECTORY, {recursive: true});
  const sqlPath = join(OUTPUT_DIRECTORY, 'cameras.sql');
  writeFileSync(sqlPath, buildSeedSql());

  // Run Wrangler's own script with this Node.js, which works the same on
  // every OS and needs no shell. `--local` targets the Miniflare database on
  // this machine only.
  execFileSync(
    process.execPath,
    [WRANGLER_SCRIPT, 'd1', 'execute', 'DB', '--local', `--file=${sqlPath}`],
    {stdio: 'inherit'},
  );
  console.log(`Seeded ${CAMERA_COUNT} synthetic cameras.`);
}

main();
