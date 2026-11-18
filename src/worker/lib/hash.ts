/**
 * @fileoverview Content hashing for change detection.
 *
 * Layer: worker library (server only).
 *
 * Jobs hash what they are about to store so they can tell whether anything
 * changed since the last run (for example, the camera import compares the
 * hash of the pin list with the one saved next to the index file in R2).
 * The hash is for change detection only, never for passwords or signatures.
 */

/**
 * Hashes text with SHA-256 using the runtime's Web Crypto API.
 *
 * The text is encoded as UTF-8 first, so the same string always gives the
 * same hash on every runtime.
 *
 * @param text The text to hash.
 * @returns The 64-character lowercase hexadecimal digest.
 * @example
 * await sha256Hex('abc');
 * // 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  // Two hex digits per byte, zero-padded so every digest has the same length.
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}
