/**
 * @fileoverview Public shapes for the satellites layer.
 *
 * Layer: shared (imported by the Worker, which builds the snapshot, and the
 * browser, which reads it). Pure schemas and constants only.
 *
 * Each item carries a satellite's mean orbital elements in OMM
 * (Orbit Mean-Elements Message) terms, trimmed to what the SGP4 orbit model
 * needs, plus a neutral display group. Positions are not stored: the browser
 * computes them from these elements for the current moment, every second.
 */
import {z} from 'zod';

/** The satellites layer's ID; also its snapshot URL segment. */
export const SATELLITE_LAYER_ID = 'satellites';

/**
 * Minutes between refreshes: four times a day. Space-Track allows at most
 * one full catalogue download per hour per account; staging and production
 * share one account and refresh in different hours (see the source).
 */
export const SATELLITE_REFRESH_MINUTES = 360;

/**
 * Neutral display groups, in panel order. Military satellites are excluded
 * at the source and never reach a snapshot.
 */
export const SATELLITE_GROUPS = [
  'stations',
  'starlink',
  'internet',
  'navigation',
  'weather',
  'science',
  'geostationary',
  'other',
] as const;

/** One display group. */
export const SatelliteGroupSchema = z.enum(SATELLITE_GROUPS);

/** One display group, such as `navigation`. */
export type SatelliteGroup = z.infer<typeof SatelliteGroupSchema>;

/**
 * An OMM epoch as Space-Track writes it: UTC without a zone suffix and with
 * up to six decimals, for example `2026-11-19T08:15:05.947776`.
 */
const OMM_EPOCH_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/;

/** An angle in degrees, 0 to 360. */
const Degrees360 = z.number().min(0).max(360);

/**
 * A drag or derivative term. Usually tiny, but freshly launched or
 * manoeuvring satellites can have fitted values of several units (BSTAR of
 * −3.25 was seen in November 2026); anything outside ±100 is corrupt.
 */
const FittedTerm = z.number().min(-100).max(100);

/** One satellite in the snapshot. */
export const SatelliteSchema = z.strictObject({
  /** NORAD catalogue number (six digits and up since 2026). */
  id: z.number().int().min(1).max(999_999_999),
  /** Object name, for example `ISS (ZARYA)`. */
  name: z.string().trim().min(1).max(64),
  /** International designator: launch year, launch number, piece. */
  intlDes: z
    .string()
    .regex(/^[0-9A-Z-]{0,16}$/)
    .max(16),
  /** Neutral display group. */
  group: SatelliteGroupSchema,
  /** When these elements were measured (OMM `EPOCH`, UTC). */
  epoch: z.string().regex(OMM_EPOCH_PATTERN),
  /** Revolutions per day. */
  meanMotion: z.number().gt(0).max(20),
  eccentricity: z.number().min(0).lt(1),
  /** Degrees, 0 to 180. */
  inclination: z.number().min(0).max(180),
  /** Right ascension of the ascending node, degrees. */
  raan: Degrees360,
  /** Argument of pericentre, degrees. */
  argPericenter: Degrees360,
  /** Mean anomaly, degrees. */
  meanAnomaly: Degrees360,
  /** SGP4 drag term (1/Earth radii). */
  bstar: FittedTerm,
  /** First derivative of mean motion (rev/day²). */
  meanMotionDot: FittedTerm,
  /** Second derivative of mean motion (rev/day³). */
  meanMotionDdot: FittedTerm,
  /** Revolution number at the epoch. */
  revAtEpoch: z.number().int().min(0).max(10_000_000),
  /** Element set number. */
  elementSetNo: z.number().int().min(0).max(100_000),
});

/** One validated satellite. */
export type Satellite = z.infer<typeof SatelliteSchema>;
