/**
 * @fileoverview Tests the CelesTrak satellites source: parsing, grouping, the
 * military exclusion, and how it follows CelesTrak's download rules.
 *
 * Layer: worker tests (workerd). The network is a fake `fetch`.
 */
import {describe, expect, it} from 'vitest';

import {OutboundError} from '../../../lib/outbound_fetch';
import {fakeFetch} from '../../../test_support/windy_fakes';
import {
  buildSatellites,
  CELESTRAK_SATELLITES,
  parseOmmCsv,
  splitCsv,
} from './celestrak_satellites';

/**
 * CelesTrak's OMM CSV header, with the last two columns swapped on purpose:
 * the parser must read columns by name, not position.
 */
const HEADER =
  'OBJECT_NAME,OBJECT_ID,EPOCH,MEAN_MOTION,ECCENTRICITY,INCLINATION,RA_OF_ASC_NODE,ARG_OF_PERICENTER,MEAN_ANOMALY,EPHEMERIS_TYPE,CLASSIFICATION_TYPE,NORAD_CAT_ID,ELEMENT_SET_NO,REV_AT_EPOCH,BSTAR,MEAN_MOTION_DDOT,MEAN_MOTION_DOT';

/** Builds one CSV row in the header's column order. */
function row(
  name: string,
  id: number,
  overrides: {meanMotion?: string} = {},
): string {
  const meanMotion = overrides.meanMotion ?? '15.50103472';
  return [
    `"${name}"`,
    '1998-067A',
    '2026-11-19T08:15:05.947776',
    meanMotion,
    '.0004209',
    '51.6342',
    '196.8462',
    '73.2156',
    '286.9318',
    '0',
    'U',
    String(id),
    '999',
    '51234',
    '.20113E-3',
    '0',
    '.11025E-3',
  ].join(',');
}

/** A CSV list from rows. */
function list(...rows: string[]): string {
  return [HEADER, ...rows].join('\r\n') + '\r\n';
}

/** The CSV response CelesTrak sends. */
function csvResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {'Content-Type': 'text/csv; charset=utf-8'},
  });
}

describe('splitCsv', () => {
  it('keeps commas and doubled quotes inside quoted fields', () => {
    expect(splitCsv('a,"b, c","say ""hi"""\r\n1,2,3\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3'],
    ]);
  });
});

describe('parseOmmCsv', () => {
  it('keys each row by column name', () => {
    const [first] = parseOmmCsv(list(row('ISS (ZARYA)', 25544)));

    expect(first?.['OBJECT_NAME']).toBe('ISS (ZARYA)');
    expect(first?.['NORAD_CAT_ID']).toBe('25544');
  });

  it('refuses a list whose header lost a required column', () => {
    expect(() => parseOmmCsv('OBJECT_NAME,NORAD_CAT_ID\r\nX,1\r\n')).toThrow(
      /missing columns/,
    );
  });
});

describe('buildSatellites', () => {
  const lists = (active: string[], groups: Record<string, string[]> = {}) => ({
    active: parseOmmCsv(list(...active)),
    groups: new Map(
      Object.entries(groups).map(([name, rows]) => [
        name,
        parseOmmCsv(list(...rows)),
      ]),
    ),
    military: parseOmmCsv(list(row('USA 999', 90001))),
  });

  it('returns validated satellites sorted by catalogue number', () => {
    const [iss] = buildSatellites(lists([row('ISS (ZARYA)', 25544)]));

    expect(iss).toEqual({
      id: 25544,
      name: 'ISS (ZARYA)',
      intlDes: '1998-067A',
      group: 'other',
      epoch: '2026-11-19T08:15:05.947776',
      meanMotion: 15.50103472,
      eccentricity: 0.0004209,
      inclination: 51.6342,
      raan: 196.8462,
      argPericenter: 73.2156,
      meanAnomaly: 286.9318,
      bstar: 0.00020113,
      meanMotionDot: 0.00011025,
      meanMotionDdot: 0,
      revAtEpoch: 51234,
      elementSetNo: 999,
    });
  });

  it('leaves out every satellite on the military list', () => {
    const satellites = buildSatellites(
      lists([row('ISS (ZARYA)', 25544), row('USA 999', 90001)]),
    );

    expect(satellites.map(s => s.id)).toEqual([25544]);
  });

  it('groups by list first, then by constellation name', () => {
    const satellites = buildSatellites(
      lists(
        [
          row('ISS (ZARYA)', 25544),
          row('GPS BIII-6', 48859),
          row('STARLINK-1007', 44713),
          row('ONEWEB-0012', 44057),
          row('NOAA 20', 43013),
          row('HUBBLE', 20580),
          row('INTELSAT 901', 26824),
          row('SOMESAT', 12345),
        ],
        {
          stations: [row('ISS (ZARYA)', 25544)],
          gnss: [row('GPS BIII-6', 48859)],
          weather: [row('NOAA 20', 43013)],
          science: [row('HUBBLE', 20580)],
          geo: [row('INTELSAT 901', 26824)],
        },
      ),
    );
    const groupOf = (id: number) => satellites.find(s => s.id === id)?.group;

    expect(groupOf(25544)).toBe('stations');
    expect(groupOf(48859)).toBe('navigation');
    expect(groupOf(44713)).toBe('starlink');
    expect(groupOf(44057)).toBe('internet');
    expect(groupOf(43013)).toBe('weather');
    expect(groupOf(20580)).toBe('science');
    expect(groupOf(26824)).toBe('geostationary');
    expect(groupOf(12345)).toBe('other');
  });

  it('skips invalid rows and keeps the rest', () => {
    const satellites = buildSatellites(
      lists([
        row('ISS (ZARYA)', 25544),
        row('BROKEN', 11111, {meanMotion: 'x'}),
      ]),
    );

    expect(satellites.map(s => s.id)).toEqual([25544]);
  });

  it('fails when a non-empty active list has no valid rows', () => {
    expect(() =>
      buildSatellites(lists([row('BROKEN', 11111, {meanMotion: '-1'})])),
    ).toThrow(/no valid satellites/);
  });
});

describe('CELESTRAK_SATELLITES', () => {
  it('downloads each list once, as CSV from celestrak.org', async () => {
    const fake = fakeFetch(url =>
      csvResponse(
        url.searchParams.get('GROUP') === 'active'
          ? list(row('ISS (ZARYA)', 25544))
          : list(),
      ),
    );

    const items = await CELESTRAK_SATELLITES.fetchItems({
      fetch: fake.fetch,
      now: new Date('2026-11-19T12:00:00Z'),
    });

    expect(items).toHaveLength(1);
    expect(fake.requests.map(r => r.url.searchParams.get('GROUP'))).toEqual([
      'active',
      'stations',
      'gnss',
      'weather',
      'resource',
      'science',
      'geo',
      'military',
    ]);
    for (const request of fake.requests) {
      expect(request.url.hostname).toBe('celestrak.org');
      expect(request.url.searchParams.get('FORMAT')).toBe('csv');
    }
  });

  it('stops at the first refusal, without retrying or asking again', async () => {
    // CelesTrak answers 403 when a list hasn't changed since our last
    // download; the refresh must stop there and keep the old snapshot.
    const fake = fakeFetch(() => csvResponse('', 403));

    await expect(
      CELESTRAK_SATELLITES.fetchItems({
        fetch: fake.fetch,
        now: new Date('2026-11-19T12:00:00Z'),
      }),
    ).rejects.toBeInstanceOf(OutboundError);
    expect(fake.requests).toHaveLength(1);
  });

  it('refreshes four times a day, well inside the two-hour rule', () => {
    expect(CELESTRAK_SATELLITES.refreshMinutes).toBe(360);
  });
});
