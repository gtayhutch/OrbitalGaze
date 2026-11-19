/**
 * @fileoverview Snapshot source for the satellites layer: CelesTrak orbit data.
 *
 * Layer: worker feature (server only). Listed in `../registry.ts`; the
 * snapshot job calls it four times a day.
 *
 * CelesTrak publishes mean orbital elements (OMM) for every tracked object,
 * grouped into lists. Each refresh downloads:
 * - `active`: every active satellite (about 17,000), the layer's items;
 * - a few small lists that sort them into neutral display groups (space
 *   stations, navigation, weather and Earth observation, science,
 *   geostationary). Starlink and the other internet constellations are
 *   recognised by name instead, which saves the largest downloads;
 * - `military`: satellites in it are left out of the layer entirely.
 *
 * CelesTrak's usage policy, which this follows:
 * - each list updates every 2 hours and may be downloaded once per update,
 *   so the layer refreshes every 6 hours;
 * - any non-200 answer stops the refresh at once (no retries); the previous
 *   snapshot stays and the next attempt is the next 6-hourly slot;
 * - CSV is preferred over JSON (a third of the size), from `celestrak.org`.
 *
 * Every row is validated against `SatelliteSchema`; rows that fail are
 * skipped, but a list whose header has changed, or an `active` list with no
 * valid rows, fails the refresh.
 */
import {
  SATELLITE_LAYER_ID,
  SATELLITE_REFRESH_MINUTES,
  SatelliteSchema,
  type Satellite,
  type SatelliteGroup,
} from '@/shared/satellites';

import {fetchText, type FetchFunction} from '../../../lib/outbound_fetch';
import type {SnapshotSource} from '../snapshot_source';

/** CelesTrak's host; the only one this source may call. */
const CELESTRAK_HOST = 'celestrak.org';

/** Largest list accepted, in bytes (the `active` list is about 2.6 MB). */
const MAX_LIST_BYTES = 4 * 1024 * 1024;

/** Most rows read from one list; a list growing past this is broken. */
const MAX_ROWS = 30_000;

/** Time allowed per download. */
const TIMEOUT_MS = 20_000;

/** The columns this source reads; a list without any of them is refused. */
const REQUIRED_COLUMNS = [
  'OBJECT_NAME',
  'OBJECT_ID',
  'EPOCH',
  'MEAN_MOTION',
  'ECCENTRICITY',
  'INCLINATION',
  'RA_OF_ASC_NODE',
  'ARG_OF_PERICENTER',
  'MEAN_ANOMALY',
  'NORAD_CAT_ID',
  'ELEMENT_SET_NO',
  'REV_AT_EPOCH',
  'BSTAR',
  'MEAN_MOTION_DOT',
  'MEAN_MOTION_DDOT',
] as const;

/** One CSV row, keyed by column name. */
type Row = Readonly<Record<string, string>>;

/**
 * CelesTrak lists that place a satellite in a display group, checked in this
 * order (a satellite in two lists gets the first).
 */
const GROUP_LISTS: readonly {list: string; group: SatelliteGroup}[] = [
  {list: 'stations', group: 'stations'},
  {list: 'gnss', group: 'navigation'},
  {list: 'weather', group: 'weather'},
  {list: 'resource', group: 'weather'},
  {list: 'science', group: 'science'},
  {list: 'geo', group: 'geostationary'},
];

/** Internet constellations recognised by name (Starlink is its own group). */
const INTERNET_NAME =
  /^(?:ONEWEB|KUIPER|QIANFAN|GUOWANG|HULIANWANG|SPACEMOBILE|LYNK)/;

/** The download URL for one CelesTrak list, as CSV. */
function listUrl(list: string): URL {
  const url = new URL(`https://${CELESTRAK_HOST}/NORAD/elements/gp.php`);
  url.searchParams.set('GROUP', list);
  url.searchParams.set('FORMAT', 'csv');
  return url;
}

/**
 * Splits CSV text into rows of fields. Handles quoted fields (with commas or
 * doubled quotes inside), which object names may need.
 *
 * @param text The CSV text.
 * @returns Every row's fields, header included.
 */
export function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (quoted) {
      if (char === '"' && text.charAt(index + 1) === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text.charAt(index + 1) === '\n') {
        index += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(cells => !(cells.length === 1 && cells[0] === ''));
}

/**
 * Parses one CelesTrak OMM CSV list into rows keyed by column.
 *
 * @param text The list as downloaded.
 * @returns The rows, at most {@link MAX_ROWS}.
 * @throws {Error} When the header lacks a required column, or the list has
 *     more rows than allowed.
 */
export function parseOmmCsv(text: string): Row[] {
  const [header, ...body] = splitCsv(text);
  const columns = (header ?? []).map(name => name.trim());
  const missing = REQUIRED_COLUMNS.filter(name => !columns.includes(name));
  if (missing.length > 0) {
    throw new Error(
      `The CelesTrak list is missing columns: ${missing.join(', ')}.`,
    );
  }
  if (body.length > MAX_ROWS) {
    throw new Error('The CelesTrak list has more rows than expected.');
  }
  return body.map(cells =>
    Object.fromEntries(columns.map((name, i) => [name, cells[i] ?? ''])),
  );
}

/** A number from a CSV field; empty or malformed fields become NaN. */
function numberField(row: Row, column: string): number {
  const text = (row[column] ?? '').trim();
  return text === '' ? Number.NaN : Number(text);
}

/** The display group for one satellite. */
function groupOf(
  name: string,
  id: number,
  listGroups: ReadonlyMap<number, SatelliteGroup>,
): SatelliteGroup {
  const fromList = listGroups.get(id);
  if (fromList === 'stations' || fromList === 'navigation') {
    return fromList;
  }
  if (name.startsWith('STARLINK')) {
    return 'starlink';
  }
  if (INTERNET_NAME.test(name)) {
    return 'internet';
  }
  return fromList ?? 'other';
}

/** The lists one refresh needs, already parsed. */
export interface CelestrakLists {
  /** The `active` list. */
  readonly active: readonly Row[];
  /** The group lists, by CelesTrak list name. */
  readonly groups: ReadonlyMap<string, readonly Row[]>;
  /** The `military` list (left out of the layer). */
  readonly military: readonly Row[];
}

/**
 * Builds the layer's items from parsed lists: excludes military satellites,
 * assigns groups, validates every row, and sorts by catalogue number.
 *
 * @param lists The parsed CelesTrak lists.
 * @returns The validated satellites.
 * @throws {Error} When the active list is not empty but no row is valid.
 */
export function buildSatellites(lists: CelestrakLists): Satellite[] {
  const militaryIds = new Set(
    lists.military.map(row => numberField(row, 'NORAD_CAT_ID')),
  );
  // First list wins, in GROUP_LISTS order.
  const listGroups = new Map<number, SatelliteGroup>();
  for (const {list, group} of GROUP_LISTS) {
    for (const row of lists.groups.get(list) ?? []) {
      const id = numberField(row, 'NORAD_CAT_ID');
      if (!listGroups.has(id)) {
        listGroups.set(id, group);
      }
    }
  }

  const satellites = new Map<number, Satellite>();
  for (const row of lists.active) {
    const id = numberField(row, 'NORAD_CAT_ID');
    if (militaryIds.has(id) || satellites.has(id)) {
      continue;
    }
    const name = (row['OBJECT_NAME'] ?? '').trim();
    const parsed = SatelliteSchema.safeParse({
      id,
      name,
      intlDes: (row['OBJECT_ID'] ?? '').trim(),
      group: groupOf(name, id, listGroups),
      epoch: (row['EPOCH'] ?? '').trim(),
      meanMotion: numberField(row, 'MEAN_MOTION'),
      eccentricity: numberField(row, 'ECCENTRICITY'),
      inclination: numberField(row, 'INCLINATION'),
      raan: numberField(row, 'RA_OF_ASC_NODE'),
      argPericenter: numberField(row, 'ARG_OF_PERICENTER'),
      meanAnomaly: numberField(row, 'MEAN_ANOMALY'),
      bstar: numberField(row, 'BSTAR'),
      meanMotionDot: numberField(row, 'MEAN_MOTION_DOT'),
      meanMotionDdot: numberField(row, 'MEAN_MOTION_DDOT'),
      revAtEpoch: numberField(row, 'REV_AT_EPOCH'),
      elementSetNo: numberField(row, 'ELEMENT_SET_NO'),
    });
    if (parsed.success) {
      satellites.set(id, parsed.data);
    }
  }
  if (lists.active.length > 0 && satellites.size === 0) {
    throw new Error('The CelesTrak active list contained no valid satellites.');
  }
  return [...satellites.values()].sort((a, b) => a.id - b.id);
}

/**
 * Downloads one list. Any failure throws, which stops the whole refresh
 * before another request is sent.
 */
async function downloadList(
  list: string,
  fetch: FetchFunction,
): Promise<Row[]> {
  const text = await fetchText(listUrl(list), {
    allowedHosts: [CELESTRAK_HOST],
    timeoutMs: TIMEOUT_MS,
    maxBytes: MAX_LIST_BYTES,
    fetch,
  });
  return parseOmmCsv(text);
}

/** Refreshes the satellites layer from CelesTrak, four times a day. */
export const CELESTRAK_SATELLITES: SnapshotSource<Satellite> = {
  id: SATELLITE_LAYER_ID,
  refreshMinutes: SATELLITE_REFRESH_MINUTES,
  // Positions are computed in the browser, so an hour-old copy is fine.
  maxAgeSeconds: 3_600,
  async fetchItems({fetch}) {
    // One list at a time, so the first failure stops every later request.
    const active = await downloadList('active', fetch);
    const groups = new Map<string, readonly Row[]>();
    for (const {list} of GROUP_LISTS) {
      groups.set(list, await downloadList(list, fetch));
    }
    const military = await downloadList('military', fetch);
    return buildSatellites({active, groups, military});
  },
};
