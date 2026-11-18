/**
 * @fileoverview Tests for the SHA-256 helper.
 *
 * Layer: worker tests (workerd, using the runtime's Web Crypto API). The
 * expected digests are the standard test vectors from FIPS 180-2.
 */
import {describe, expect, it} from 'vitest';

import {sha256Hex} from './hash';

describe('sha256Hex', () => {
  it('matches the standard digest of empty text', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches the standard digest of "abc"', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('gives the same hash for the same text and a new one when it changes', async () => {
    const first = await sha256Hex('Zürich');

    expect(await sha256Hex('Zürich')).toBe(first);
    expect(await sha256Hex('Zurich')).not.toBe(first);
  });
});
