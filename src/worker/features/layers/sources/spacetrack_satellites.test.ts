/**
 * @fileoverview Tests the Space-Track satellites source: login, the one
 * catalogue query, logout, parsing, and failure handling.
 *
 * Layer: worker tests (workerd). Space-Track is a fake `fetch`; no test
 * reaches the network or needs real credentials.
 */
import {describe, expect, it} from 'vitest';

import {OutboundError} from '../../../lib/outbound_fetch';
import {buildWorkerConfig} from '../../../test_support/factories';
import {fakeFetch, jsonResponse} from '../../../test_support/windy_fakes';
import {SourceNotConfiguredError} from '../snapshot_source';
import {
  buildSatellitesFromGp,
  GP_QUERY_URL,
  SPACETRACK_SATELLITES,
} from './spacetrack_satellites';

/** Marker strings that must never appear in errors. */
const IDENTITY = 'owner@example.test';
const PASSWORD = 'secret-marker-7f3a';
const SESSION = 'session-marker-91c2';

const CONFIG = buildWorkerConfig({
  spaceTrack: {identity: IDENTITY, password: PASSWORD},
});

/** One GP row as Space-Track sends it (strings throughout). */
function gpRow(
  id: string,
  name: string,
  overrides: Record<string, string> = {},
) {
  return {
    NORAD_CAT_ID: id,
    OBJECT_NAME: name,
    OBJECT_ID: '1998-067A',
    EPOCH: '2026-11-19T08:15:05.947776',
    MEAN_MOTION: '15.50103472',
    ECCENTRICITY: '0.00042090',
    INCLINATION: '51.6342',
    RA_OF_ASC_NODE: '196.8462',
    ARG_OF_PERICENTER: '73.2156',
    MEAN_ANOMALY: '286.9318',
    BSTAR: '0.00020113',
    MEAN_MOTION_DOT: '0.00011025',
    MEAN_MOTION_DDOT: '0',
    REV_AT_EPOCH: '51234',
    ELEMENT_SET_NO: '999',
    ...overrides,
  };
}

/** A login answer: success sets the session cookie. */
function loginResponse(ok = true): Response {
  const headers = new Headers({'Content-Type': 'application/json'});
  if (ok) {
    headers.append('Set-Cookie', `chocolatechip=${SESSION}; path=/; secure`);
  }
  return new Response(ok ? '""' : '{"Login":"Failed"}', {status: 200, headers});
}

/** A fake Space-Track serving `rows` (or a status) for the GP query. */
function fakeSpaceTrack(options: {
  rows?: unknown;
  loginOk?: boolean;
  queryStatus?: number;
}) {
  return fakeFetch(url => {
    if (url.pathname === '/ajaxauth/login') {
      return loginResponse(options.loginOk ?? true);
    }
    if (url.pathname === '/ajaxauth/logout') {
      return new Response('');
    }
    if (options.queryStatus !== undefined) {
      return new Response('Too many requests', {status: options.queryStatus});
    }
    return jsonResponse(options.rows ?? []);
  });
}

/** Runs the source with the test config. */
function run(fetch: ReturnType<typeof fakeFetch>['fetch'], config = CONFIG) {
  return SPACETRACK_SATELLITES.fetchItems({
    fetch,
    now: new Date('2026-11-20T06:25:00Z'),
    config,
  });
}

describe('buildSatellitesFromGp', () => {
  it('converts string fields and assigns groups, sorted by catalogue number', () => {
    const satellites = buildSatellitesFromGp([
      gpRow('44713', 'STARLINK-1007'),
      gpRow('101414', 'NEWSAT 1'),
      gpRow('25544', 'ISS (ZARYA)'),
    ]);

    expect(satellites.map(s => [s.id, s.group])).toEqual([
      [25544, 'stations'],
      [44713, 'starlink'],
      [101414, 'other'],
    ]);
    expect(satellites[0]).toMatchObject({
      name: 'ISS (ZARYA)',
      intlDes: '1998-067A',
      meanMotion: 15.50103472,
      bstar: 0.00020113,
      revAtEpoch: 51234,
    });
  });

  it('skips invalid rows and keeps the rest', () => {
    const satellites = buildSatellitesFromGp([
      gpRow('25544', 'ISS (ZARYA)'),
      gpRow('11111', 'BROKEN', {MEAN_MOTION: 'x'}),
      {NORAD_CAT_ID: '22222'},
    ]);

    expect(satellites.map(s => s.id)).toEqual([25544]);
  });

  it('fails when rows arrive but none is valid', () => {
    expect(() =>
      buildSatellitesFromGp([gpRow('11111', 'BROKEN', {MEAN_MOTION: '-1'})]),
    ).toThrow(/no valid satellites/);
  });
});

describe('SPACETRACK_SATELLITES', () => {
  it('logs in, makes one catalogue query with the session, then logs out', async () => {
    const fake = fakeSpaceTrack({rows: [gpRow('25544', 'ISS (ZARYA)')]});

    const items = await run(fake.fetch);

    expect(items).toHaveLength(1);
    expect(fake.requests.map(r => r.url.pathname.split('/class/')[0])).toEqual([
      '/ajaxauth/login',
      '/basicspacedata/query',
      '/ajaxauth/logout',
    ]);
    const query = fake.requests[1];
    expect(query?.url.toString()).toBe(GP_QUERY_URL.toString());
    expect(query?.headers.get('Cookie')).toBe(`chocolatechip=${SESSION}`);
    for (const request of fake.requests) {
      expect(request.url.hostname).toBe('www.space-track.org');
      expect(request.redirect).toBe('manual');
    }
  });

  it('asks only for payloads in orbit with recent elements, as JSON', () => {
    const path = decodeURIComponent(GP_QUERY_URL.pathname);

    expect(path).toContain('/class/gp/OBJECT_TYPE/PAYLOAD/decay_date/null-val');
    expect(path).toContain('/epoch/>now-10/');
    expect(path).toContain('/predicates/NORAD_CAT_ID,OBJECT_NAME,');
    expect(path).toContain('/orderby/NORAD_CAT_ID/format/json');
  });

  it('sends no request at all without credentials', async () => {
    const fake = fakeSpaceTrack({});

    await expect(run(fake.fetch, buildWorkerConfig())).rejects.toBeInstanceOf(
      SourceNotConfiguredError,
    );
    expect(fake.requests).toHaveLength(0);
  });

  it('stops after a refused login, without querying', async () => {
    const fake = fakeSpaceTrack({loginOk: false});

    const error = await run(fake.fetch).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OutboundError);
    expect(fake.requests).toHaveLength(1);
  });

  it('fails on a query error and still logs out', async () => {
    const fake = fakeSpaceTrack({queryStatus: 429});

    const error = await run(fake.fetch).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OutboundError);
    expect((error as OutboundError).status).toBe(429);
    expect(fake.requests.map(r => r.url.pathname).at(-1)).toBe(
      '/ajaxauth/logout',
    );
  });

  it('never puts the credentials or the session in an error', async () => {
    for (const fake of [
      fakeSpaceTrack({loginOk: false}),
      fakeSpaceTrack({queryStatus: 500}),
      fakeSpaceTrack({rows: [{NORAD_CAT_ID: 'x'}]}),
    ]) {
      const error = await run(fake.fetch).catch((caught: unknown) => caught);
      const text = `${String(error)} ${JSON.stringify(error)}`;

      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain(IDENTITY);
      expect(text).not.toContain(SESSION);
    }
  });

  it('refreshes every 6 hours at the environment offset', () => {
    expect(SPACETRACK_SATELLITES.refreshMinutes).toBe(360);
    expect(
      SPACETRACK_SATELLITES.refreshOffsetMinutes?.(
        buildWorkerConfig({satelliteRefreshOffsetMinutes: 205}),
      ),
    ).toBe(205);
  });
});
