/**
 * @fileoverview Finds satellites by name or catalogue number.
 *
 * Layer: client feature (browser only). Pure, unit-tested; used by the
 * search dialog while the satellites layer is on. Matching runs in the
 * browser over the loaded catalogue (about 17,000 names), which takes well
 * under a millisecond per keystroke.
 */

/** The searchable part of the catalogue. */
export interface SatelliteSearchIndex {
  /** NORAD catalogue numbers, in catalogue order. */
  readonly ids: readonly number[];
  /** Object names, in the same order. */
  readonly names: readonly string[];
}

/** Shortest query that searches by name. */
export const MIN_SATELLITE_QUERY_LENGTH = 2;

/**
 * The best matches for a query: an exact catalogue number first, then names
 * that start with the query, then names that contain it; each in catalogue
 * order.
 *
 * @param query What the visitor typed.
 * @param index The loaded catalogue.
 * @param limit Most results returned.
 * @returns Positions in the catalogue.
 * @example
 * searchSatellites('iss', index, 5); // [position of "ISS (ZARYA)", …]
 * searchSatellites('25544', index, 5); // [position of 25544]
 */
export function searchSatellites(
  query: string,
  index: SatelliteSearchIndex,
  limit: number,
): number[] {
  const needle = query.trim().toUpperCase();
  if (needle.length === 0) {
    return [];
  }
  const results: number[] = [];
  // Step 1: a catalogue number.
  if (/^\d{1,9}$/.test(needle)) {
    const position = index.ids.indexOf(Number(needle));
    if (position !== -1) {
      results.push(position);
    }
  }
  if (needle.length < MIN_SATELLITE_QUERY_LENGTH) {
    return results.slice(0, limit);
  }
  // Step 2: names starting with the query, then names containing it.
  const contains: number[] = [];
  for (let position = 0; position < index.names.length; position += 1) {
    if (results.length >= limit) {
      break;
    }
    const name = index.names[position] ?? '';
    if (results.includes(position)) {
      continue;
    }
    if (name.startsWith(needle)) {
      results.push(position);
    } else if (contains.length < limit && name.includes(needle)) {
      contains.push(position);
    }
  }
  return [...results, ...contains].slice(0, limit);
}
