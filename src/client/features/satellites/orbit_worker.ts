/**
 * @fileoverview Web worker that computes where every satellite is.
 *
 * Layer: client feature (browser only, runs off the main thread). Started by
 * `use_satellites.ts` with `new Worker(new URL(...))`, so it is a separate
 * script on our own origin.
 *
 * It does the heavy work so the page never stutters:
 * 1. downloads the satellites snapshot (about 6 MB, 17,000 satellites) and
 *    validates it with the shared schema;
 * 2. builds one SGP4 orbit model ("satrec") per satellite, once;
 * 3. on each tick, propagates every visible satellite to that moment and
 *    sends back one Float32Array of [lng, lat, altitude m], transferred
 *    rather than copied;
 * 4. for the followed satellite, also sends its speed, and one orbit's path.
 *
 * It uses satellite.js's plain JavaScript propagator. The library also has a
 * WebAssembly bulk propagator, which would need `'wasm-unsafe-eval'` in our
 * Content Security Policy; the plain one handles 17,000 satellites in about
 * 45 ms per tick on a laptop.
 */
import '@/client/lib/zod_setup';

import {
  degreesLat,
  degreesLong,
  eciToGeodetic,
  gstime,
  json2satrec,
  propagate,
  type OMMJsonObject,
  type SatRec,
} from './sgp4';

import {layerSnapshotSchema} from '@/shared/layers';
import {
  SATELLITE_LAYER_ID,
  SatelliteGroupSchema,
  SatelliteSchema,
  type Satellite,
  type SatelliteGroup,
} from '@/shared/satellites';
import {dataEnvelope} from '@/shared/api/envelope';
import {z} from 'zod';

import type {
  OrbitRequest,
  OrbitResponse,
  SelectedState,
} from './orbit_protocol';

/** The snapshot as the API sends it: `{data: {layerId, checkedAt, items}}`. */
const SnapshotEnvelopeSchema = dataEnvelope(
  layerSnapshotSchema(SatelliteSchema),
);

/**
 * Where the snapshot is: our own API, on the worker's own origin. The worker
 * never fetches an address it is sent.
 */
const SNAPSHOT_PATH = `/api/v1/layers/${SATELLITE_LAYER_ID}`;

/**
 * Every request the page may send. A dedicated worker only hears from the
 * page that started it (such messages carry no origin to check), but each
 * one is still validated before use.
 */
const OrbitRequestSchema = z.discriminatedUnion('type', [
  z.object({type: z.literal('load')}),
  z.object({type: z.literal('tick'), time: z.number().int().nonnegative()}),
  z.object({
    type: z.literal('groups'),
    groups: z.array(SatelliteGroupSchema).max(20),
  }),
  z.object({
    type: z.literal('select'),
    id: z.number().int().min(1).max(999_999_999).nullable(),
  }),
]) satisfies z.ZodType<OrbitRequest>;

/** Points along one drawn orbit. */
const PATH_POINTS = 180;

/** The worker's state: the orbit models and what to show. */
let satellites: readonly Satellite[] = [];
let satrecs: readonly (SatRec | null)[] = [];
let visible: ReadonlySet<SatelliteGroup> | null = null;
let selectedIndex = -1;

/** Sends a message to the page, transferring any buffers listed. */
function send(message: OrbitResponse, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(message, transfer);
}

/** The OMM record satellite.js reads, from one snapshot item. */
function toOmm(satellite: Satellite): OMMJsonObject {
  // Safe: these are the OMM keywords json2satrec reads; the remaining
  // optional OMM fields aren't needed by SGP4.
  return {
    OBJECT_NAME: satellite.name,
    OBJECT_ID: satellite.intlDes,
    EPOCH: satellite.epoch,
    MEAN_MOTION: satellite.meanMotion,
    ECCENTRICITY: satellite.eccentricity,
    INCLINATION: satellite.inclination,
    RA_OF_ASC_NODE: satellite.raan,
    ARG_OF_PERICENTER: satellite.argPericenter,
    MEAN_ANOMALY: satellite.meanAnomaly,
    EPHEMERIS_TYPE: 0,
    CLASSIFICATION_TYPE: 'U',
    NORAD_CAT_ID: satellite.id,
    ELEMENT_SET_NO: satellite.elementSetNo,
    REV_AT_EPOCH: satellite.revAtEpoch,
    BSTAR: satellite.bstar,
    MEAN_MOTION_DOT: satellite.meanMotionDot,
    MEAN_MOTION_DDOT: satellite.meanMotionDdot,
  } as unknown as OMMJsonObject;
}

/** Where one satellite is at `date`, or null if SGP4 can't place it. */
function locate(
  satrec: SatRec,
  date: Date,
  gmst: number,
): {lng: number; lat: number; altitudeKm: number; speedKmS: number} | null {
  const state = propagate(satrec, date);
  if (state === null || typeof state.position !== 'object') {
    return null;
  }
  const geodetic = eciToGeodetic(state.position, gmst);
  const {x, y, z} = state.velocity;
  return {
    lng: degreesLong(geodetic.longitude),
    lat: degreesLat(geodetic.latitude),
    altitudeKm: geodetic.height,
    speedKmS: Math.hypot(x, y, z),
  };
}

/** Step 1 and 2: download, validate, and build the orbit models. */
async function load(): Promise<void> {
  const url = new URL(SNAPSHOT_PATH, self.location.origin);
  const response = await fetch(url, {headers: {Accept: 'application/json'}});
  if (!response.ok) {
    send({type: 'load-failed', notFound: response.status === 404});
    return;
  }
  const parsed = SnapshotEnvelopeSchema.safeParse(await response.json());
  if (!parsed.success) {
    // Paths and messages only: never the data itself.
    console.error(
      'The satellites snapshot did not match the expected shape.',
      JSON.stringify(
        parsed.error.issues.slice(0, 3).map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      ),
    );
    send({type: 'load-failed', notFound: false});
    return;
  }
  const {checkedAt, items} = parsed.data.data;
  satellites = items;
  satrecs = items.map(satellite => {
    try {
      return json2satrec(toOmm(satellite));
    } catch {
      return null;
    }
  });
  selectedIndex = -1;
  send({
    type: 'catalog',
    catalog: {
      checkedAt,
      ids: items.map(s => s.id),
      names: items.map(s => s.name),
      intlDes: items.map(s => s.intlDes),
      groups: items.map(s => s.group),
      meanMotion: items.map(s => s.meanMotion),
      eccentricity: items.map(s => s.eccentricity),
      inclination: items.map(s => s.inclination),
      epochs: items.map(s => s.epoch),
    },
  });
}

/** Step 3: every visible satellite's position at `time`. */
function tick(time: number): void {
  const started = performance.now();
  const date = new Date(time);
  const gmst = gstime(date);
  const positions = new Float32Array(satrecs.length * 3).fill(Number.NaN);
  satrecs.forEach((satrec, index) => {
    const satellite = satellites[index];
    if (
      satrec === null ||
      satellite === undefined ||
      (visible !== null && !visible.has(satellite.group))
    ) {
      return;
    }
    const where = locate(satrec, date, gmst);
    if (where !== null) {
      positions[index * 3] = where.lng;
      positions[index * 3 + 1] = where.lat;
      positions[index * 3 + 2] = where.altitudeKm * 1_000;
    }
  });

  // Step 4: the followed satellite's live state.
  let selected: SelectedState | null = null;
  const selectedSatrec = satrecs[selectedIndex];
  const selectedSatellite = satellites[selectedIndex];
  if (
    selectedSatrec !== null &&
    selectedSatrec !== undefined &&
    selectedSatellite !== undefined
  ) {
    const where = locate(selectedSatrec, date, gmst);
    if (where !== null) {
      selected = {id: selectedSatellite.id, ...where};
    }
  }
  send(
    {
      type: 'positions',
      positions,
      selected,
      computeMs: performance.now() - started,
    },
    [positions.buffer],
  );
}

/** Step 4: one orbit of the followed satellite, from now. */
function sendPath(index: number): void {
  const satrec = satrecs[index];
  const satellite = satellites[index];
  if (satrec === null || satrec === undefined || satellite === undefined) {
    return;
  }
  const periodMs = 86_400_000 / satellite.meanMotion;
  const start = Date.now();
  const path = new Float32Array(PATH_POINTS * 3).fill(Number.NaN);
  for (let point = 0; point < PATH_POINTS; point += 1) {
    const date = new Date(start + (periodMs * point) / (PATH_POINTS - 1));
    const where = locate(satrec, date, gstime(date));
    if (where !== null) {
      path[point * 3] = where.lng;
      path[point * 3 + 1] = where.lat;
      path[point * 3 + 2] = where.altitudeKm * 1_000;
    }
  }
  send({type: 'path', id: satellite.id, path}, [path.buffer]);
}

self.onmessage = (event: MessageEvent<unknown>) => {
  const parsed = OrbitRequestSchema.safeParse(event.data);
  if (!parsed.success) {
    return;
  }
  const request = parsed.data;
  switch (request.type) {
    case 'load':
      void load().catch((error: unknown) => {
        console.error('Could not load the satellites.', error);
        send({type: 'load-failed', notFound: false});
      });
      break;
    case 'tick':
      tick(request.time);
      break;
    case 'groups':
      visible = new Set(request.groups);
      break;
    case 'select':
      selectedIndex =
        request.id === null
          ? -1
          : satellites.findIndex(satellite => satellite.id === request.id);
      if (selectedIndex !== -1) {
        sendPath(selectedIndex);
      }
      break;
  }
};
