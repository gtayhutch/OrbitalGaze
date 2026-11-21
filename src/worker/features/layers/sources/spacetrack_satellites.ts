/**
 * @fileoverview Snapshot source for the satellites layer: Space-Track.org.
 *
 * Layer: worker feature (server only). Listed in `../registry.ts`; the
 * snapshot job calls it four times a day.
 *
 * Space-Track.org is the US Space Force's public satellite catalogue (the
 * source CelesTrak republishes). It needs a free account; requests are
 * limited per account, not per network address, so it works from
 * Cloudflare's shared addresses. Each refresh:
 * 1. logs in with the account (Worker secrets) and keeps the session cookie;
 * 2. asks once for the current mean elements (GP class) of every payload
 *    still in orbit with elements from the last 10 days, only the fields
 *    SGP4 needs, as JSON;
 * 3. logs out (best effort).
 *
 * Space-Track's API guidance, which this follows:
 * - at most one full GP download per hour per account, at a minute away
 *   from :00 and :30. The refresh runs every 6 hours at an
 *   environment-specific offset (`SATELLITE_REFRESH_OFFSET_MINUTES`), so
 *   staging and production, which share one account, never pull in the
 *   same hour;
 * - one bulk query instead of many small ones;
 * - stop at the first failure: no retries until the next scheduled slot.
 *
 * Owner decisions (2026-11-20): every published payload is shown, with no
 * military exclusion; groups are neutral (`satellite_classification.ts`).
 * The data is credited to Space-Track.org in the layer's credit line.
 *
 * Credentials and the session cookie are never logged or put in errors.
 * Without credentials the source sends no request and reports
 * "not configured".
 */
import {z} from 'zod';

import {
  SATELLITE_LAYER_ID,
  SATELLITE_REFRESH_MINUTES,
  SatelliteSchema,
  type Satellite,
} from '@/shared/satellites';

import {
  fetchJson,
  postFormForCookie,
  type FetchFunction,
} from '../../../lib/outbound_fetch';
import {
  SourceNotConfiguredError,
  type SnapshotSource,
} from '../snapshot_source';
import {classifySatellite} from './satellite_classification';

/** Space-Track's host; the only one this source may call. */
const SPACE_TRACK_HOST = 'www.space-track.org';

/** Time allowed for the login and logout. */
const AUTH_TIMEOUT_MS = 15_000;

/** Time allowed for the catalogue query (a few megabytes). */
const QUERY_TIMEOUT_MS = 60_000;

/** Largest login answer accepted (it is a few bytes). */
const MAX_LOGIN_BYTES = 4 * 1024;

/** Largest catalogue answer accepted. */
const MAX_QUERY_BYTES = 24 * 1024 * 1024;

/** Most rows accepted; more means something is wrong upstream. */
const MAX_ROWS = 40_000;

/** Days of element age kept: anything older isn't worth propagating. */
const MAX_ELEMENT_AGE_DAYS = 10;

/** The fields requested (and read), in Space-Track's names. */
const FIELDS = [
  'NORAD_CAT_ID',
  'OBJECT_NAME',
  'OBJECT_ID',
  'EPOCH',
  'MEAN_MOTION',
  'ECCENTRICITY',
  'INCLINATION',
  'RA_OF_ASC_NODE',
  'ARG_OF_PERICENTER',
  'MEAN_ANOMALY',
  'BSTAR',
  'MEAN_MOTION_DOT',
  'MEAN_MOTION_DDOT',
  'REV_AT_EPOCH',
  'ELEMENT_SET_NO',
] as const;

/** The login URL. */
const LOGIN_URL = new URL(`https://${SPACE_TRACK_HOST}/ajaxauth/login`);

/** The logout URL. */
const LOGOUT_URL = new URL(`https://${SPACE_TRACK_HOST}/ajaxauth/logout`);

/**
 * The one catalogue query: current elements of every payload still in
 * orbit, updated in the last {@link MAX_ELEMENT_AGE_DAYS} days, ordered by
 * catalogue number. Built from fixed parts only.
 */
export const GP_QUERY_URL = new URL(
  `https://${SPACE_TRACK_HOST}/basicspacedata/query/class/gp` +
    '/OBJECT_TYPE/PAYLOAD/decay_date/null-val' +
    `/epoch/%3Enow-${String(MAX_ELEMENT_AGE_DAYS)}` +
    `/predicates/${FIELDS.join(',')}` +
    '/orderby/NORAD_CAT_ID/format/json',
);

/** Space-Track answers a refused login with this text (and HTTP 200). */
function isLoginRefused(text: string): boolean {
  return /"Login"\s*:\s*"Failed"/i.test(text);
}

/** A number Space-Track may send as a string (or null when unknown). */
const NumericField = z.union([z.string(), z.number()]).nullable();

/** One row as Space-Track sends it (all fields as strings). */
const GpRowSchema = z.object({
  NORAD_CAT_ID: NumericField,
  OBJECT_NAME: z.string().nullable(),
  OBJECT_ID: z.string().nullable(),
  EPOCH: z.string().nullable(),
  MEAN_MOTION: NumericField,
  ECCENTRICITY: NumericField,
  INCLINATION: NumericField,
  RA_OF_ASC_NODE: NumericField,
  ARG_OF_PERICENTER: NumericField,
  MEAN_ANOMALY: NumericField,
  BSTAR: NumericField,
  MEAN_MOTION_DOT: NumericField,
  MEAN_MOTION_DDOT: NumericField,
  REV_AT_EPOCH: NumericField,
  ELEMENT_SET_NO: NumericField,
});

/** The whole answer: an array of rows, capped. */
const GpResponseSchema = z.array(z.unknown()).max(MAX_ROWS);

/** A number from a field; missing or malformed values become NaN. */
function toNumber(value: string | number | null): number {
  if (value === null || (typeof value === 'string' && value.trim() === '')) {
    return Number.NaN;
  }
  return Number(value);
}

/**
 * Builds the layer's items from Space-Track's answer: validates each row,
 * assigns its group, and sorts by catalogue number.
 *
 * @param input The parsed JSON answer.
 * @returns The validated satellites.
 * @throws {z.ZodError} When the answer isn't an array of at most 40,000
 *     rows.
 * @throws {Error} When the answer has rows but none is valid.
 */
export function buildSatellitesFromGp(input: unknown): Satellite[] {
  const rows = GpResponseSchema.parse(input);
  const satellites = new Map<number, Satellite>();
  for (const raw of rows) {
    const row = GpRowSchema.safeParse(raw);
    if (!row.success) {
      continue;
    }
    const gp = row.data;
    const id = toNumber(gp.NORAD_CAT_ID);
    const name = (gp.OBJECT_NAME ?? '').trim();
    const meanMotion = toNumber(gp.MEAN_MOTION);
    const eccentricity = toNumber(gp.ECCENTRICITY);
    const inclination = toNumber(gp.INCLINATION);
    const parsed = SatelliteSchema.safeParse({
      id,
      name,
      intlDes: (gp.OBJECT_ID ?? '').trim(),
      group: classifySatellite({
        id,
        name,
        meanMotion,
        eccentricity,
        inclination,
      }),
      epoch: (gp.EPOCH ?? '').trim(),
      meanMotion,
      eccentricity,
      inclination,
      raan: toNumber(gp.RA_OF_ASC_NODE),
      argPericenter: toNumber(gp.ARG_OF_PERICENTER),
      meanAnomaly: toNumber(gp.MEAN_ANOMALY),
      bstar: toNumber(gp.BSTAR),
      meanMotionDot: toNumber(gp.MEAN_MOTION_DOT),
      meanMotionDdot: toNumber(gp.MEAN_MOTION_DDOT),
      revAtEpoch: toNumber(gp.REV_AT_EPOCH),
      elementSetNo: toNumber(gp.ELEMENT_SET_NO),
    });
    if (parsed.success && !satellites.has(id)) {
      satellites.set(id, parsed.data);
    }
  }
  if (rows.length > 0 && satellites.size === 0) {
    throw new Error('The Space-Track answer contained no valid satellites.');
  }
  return [...satellites.values()].sort((a, b) => a.id - b.id);
}

/** Logs out, ignoring any failure (the session also expires on its own). */
async function logOut(cookie: string, fetchFn: FetchFunction): Promise<void> {
  try {
    const response = await fetchFn(LOGOUT_URL.toString(), {
      method: 'GET',
      headers: {Cookie: cookie},
      redirect: 'manual',
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
    await response.body?.cancel();
  } catch {
    // Best effort only.
  }
}

/** Refreshes the satellites layer from Space-Track, four times a day. */
export const SPACETRACK_SATELLITES: SnapshotSource<Satellite> = {
  id: SATELLITE_LAYER_ID,
  refreshMinutes: SATELLITE_REFRESH_MINUTES,
  // Positions are computed in the browser, so an hour-old copy is fine.
  maxAgeSeconds: 3_600,
  refreshOffsetMinutes: config => config.satelliteRefreshOffsetMinutes,
  async fetchItems({fetch, config}) {
    // Step 0: no account set, no request.
    if (config.spaceTrack === null) {
      throw new SourceNotConfiguredError(SATELLITE_LAYER_ID);
    }

    // Step 1: log in. A refusal or failure stops here.
    const form = new URLSearchParams({
      identity: config.spaceTrack.identity,
      password: config.spaceTrack.password,
    });
    const cookie = await postFormForCookie(
      LOGIN_URL,
      form,
      {
        allowedHosts: [SPACE_TRACK_HOST],
        timeoutMs: AUTH_TIMEOUT_MS,
        maxBytes: MAX_LOGIN_BYTES,
        fetch,
      },
      isLoginRefused,
    );

    // Step 2: one catalogue query; Step 3: log out whatever happens.
    try {
      const body = await fetchJson(GP_QUERY_URL, {
        allowedHosts: [SPACE_TRACK_HOST],
        headers: {Cookie: cookie},
        timeoutMs: QUERY_TIMEOUT_MS,
        maxBytes: MAX_QUERY_BYTES,
        fetch,
      });
      return buildSatellitesFromGp(body);
    } finally {
      await logOut(cookie, fetch);
    }
  },
};
