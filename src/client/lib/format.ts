/**
 * @fileoverview Small display-formatting helpers shared by several screens.
 *
 * Layer: client library (browser only).
 *
 * Uses the browser's built-in internationalization (`Intl`) so names and
 * numbers follow the visitor's language and region settings.
 */

/**
 * Turns a two-letter country code into its name in the visitor's language.
 *
 * @param countryCode ISO 3166-1 alpha-2 code, for example "JP".
 * @returns The country name ("Japan"), or the code itself if the browser
 *     can't name it.
 * @example
 * countryName('JP'); // "Japan" for an English-speaking visitor
 */
export function countryName(countryCode: string): string {
  try {
    return (
      new Intl.DisplayNames(undefined, {type: 'region'}).of(countryCode) ??
      countryCode
    );
  } catch {
    // RangeError: not a code this browser recognizes.
    return countryCode;
  }
}

/**
 * Joins a place name and country into one line, skipping missing parts.
 *
 * @param placeName City or area, if known.
 * @param countryCode Two-letter country code, if known.
 * @returns For example "Tokyo, Japan", "Japan", or "" when both are missing.
 */
export function formatPlace(
  placeName: string | null,
  countryCode: string | null,
): string {
  const country = countryCode === null ? null : countryName(countryCode);
  return [placeName, country].filter(part => part !== null).join(', ');
}
