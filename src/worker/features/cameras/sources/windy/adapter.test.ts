/**
 * @fileoverview Tests for turning Windy webcams into cameras.
 *
 * Layer: worker tests (workerd).
 */
import {describe, expect, it} from 'vitest';

import {CameraIdSchema} from '@/shared/cameras';

import {buildWindyWebcam} from '../../../../test_support/windy_fakes';
import {
  lookUpTimeZone,
  toCameraCategory,
  toNewCamera,
  WINDY_SOURCE,
} from './adapter';
import {WindyWebcamSchema} from './schemas';

/** Validates a fake webcam the way the client does, then converts it. */
function convert(overrides: Parameters<typeof buildWindyWebcam>[0] = {}) {
  return toNewCamera(WindyWebcamSchema.parse(buildWindyWebcam(overrides)));
}

describe('toNewCamera', () => {
  it('maps a Windy webcam onto a camera with a valid public ID', () => {
    const camera = convert({
      webcamId: 1358084658,
      title: 'Zermatt: Matterhorn',
      location: {
        city: 'Zermatt',
        region: 'Valais',
        country_code: 'ch',
        latitude: 46.02,
        longitude: 7.75,
      },
      categories: [{id: 'mountain'}],
    });

    expect(camera).toEqual({
      id: 'windy-1358084658',
      sourceId: 'windy',
      externalId: '1358084658',
      title: 'Zermatt: Matterhorn',
      lat: 46.02,
      lng: 7.75,
      countryCode: 'CH',
      placeName: 'Zermatt, Valais',
      timeZone: 'Europe/Zurich',
      category: 'nature',
      streamType: 'embed',
      streamRef: '1358084658',
      status: 'online',
    });
    expect(CameraIdSchema.safeParse(camera.id).success).toBe(true);
  });

  it('marks an inactive webcam offline', () => {
    expect(convert({status: 'inactive'}).status).toBe('offline');
  });

  it('leaves out place and country when Windy does not know them', () => {
    const camera = convert({
      location: {
        city: null,
        region: '',
        country_code: 'not-a-code',
        latitude: 0,
        longitude: -140,
      },
    });

    expect(camera.placeName).toBeNull();
    expect(camera.countryCode).toBeNull();
  });

  it('does not repeat a region that matches the city', () => {
    expect(convert().placeName).toBe('Tokyo');
  });

  it('shortens titles longer than the database allows', () => {
    expect(convert({title: 'x'.repeat(300)}).title).toHaveLength(200);
  });
});

describe('toCameraCategory', () => {
  it('maps Windy categories onto ours, specific subjects first', () => {
    expect(toCameraCategory(['city', 'beach'])).toBe('beach');
    expect(toCameraCategory(['landscape', 'traffic'])).toBe('traffic');
    expect(toCameraCategory(['meteo'])).toBe('weather');
    expect(toCameraCategory(['building'])).toBe('landmark');
    expect(toCameraCategory(['City'])).toBe('city');
  });

  it("maps every category in Windy's published list", () => {
    // Windy's list as of 2026-11-18, with the category each one becomes.
    const expected = {
      airport: 'other',
      beach: 'beach',
      building: 'landmark',
      city: 'city',
      coast: 'beach',
      forest: 'nature',
      indoor: 'other',
      lake: 'nature',
      landscape: 'nature',
      meteo: 'weather',
      mountain: 'nature',
      observatory: 'landmark',
      port: 'city',
      river: 'nature',
      sportArea: 'other',
      square: 'city',
      traffic: 'traffic',
      village: 'city',
    };

    for (const [windyId, category] of Object.entries(expected)) {
      expect(toCameraCategory([windyId]), windyId).toBe(category);
    }
  });

  it('uses "other" for unknown or missing categories', () => {
    expect(toCameraCategory(['harbor'])).toBe('other');
    expect(toCameraCategory([])).toBe('other');
  });
});

describe('lookUpTimeZone', () => {
  it('finds the time zone for land coordinates', () => {
    expect(lookUpTimeZone(35.68, 139.76)).toBe('Asia/Tokyo');
    // Fiji sits on the antimeridian.
    expect(lookUpTimeZone(-17.7, 178.0)).toBe('Pacific/Fiji');
  });

  it('gives a nautical zone over open sea', () => {
    expect(lookUpTimeZone(0, -140)).toBe('Etc/GMT+9');
  });

  it('returns null instead of throwing for impossible coordinates', () => {
    expect(lookUpTimeZone(91, 0)).toBeNull();
  });
});

describe('WINDY_SOURCE', () => {
  it('carries the credit Windy requires and is not cleared for commercial use', () => {
    expect(WINDY_SOURCE.attributionText).toBe('Webcams provided by windy.com');
    expect(WINDY_SOURCE.homepageUrl).toBe('https://www.windy.com/');
    expect(WINDY_SOURCE.commercialUseAllowed).toBe(false);
  });

  it("allows the bare windy.com host that Windy's camera page links use", () => {
    expect(WINDY_SOURCE.allowedHosts).toContain('windy.com');
  });
});
