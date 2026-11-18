/**
 * @fileoverview Unit tests for turning search text into a safe FTS5 query.
 *
 * Layer: worker tests (pure function).
 */
import {describe, expect, it} from 'vitest';

import {MAX_SEARCH_TERMS, toFtsQuery} from './search_query';

describe('toFtsQuery', () => {
  it('quotes each word and matches it as a prefix', () => {
    expect(toFtsQuery('new york')).toBe('"new"* "york"*');
  });

  it('collapses repeated whitespace', () => {
    expect(toFtsQuery('  new \t york  ')).toBe('"new"* "york"*');
  });

  it('turns operators into plain words', () => {
    expect(toFtsQuery('a OR b')).toBe('"a"* "OR"* "b"*');
    expect(toFtsQuery('title:x')).toBe('"title:x"*');
  });

  it('escapes double quotes by doubling them', () => {
    expect(toFtsQuery('say "hi"')).toBe('"say"* """hi"""*');
  });

  it('skips words with no letters or digits', () => {
    expect(toFtsQuery('tokyo *** ()')).toBe('"tokyo"*');
    expect(toFtsQuery('*** ()')).toBeNull();
  });

  it('keeps letters from any script', () => {
    expect(toFtsQuery('東京 São')).toBe('"東京"* "São"*');
  });

  it('uses at most the first few words', () => {
    const words = Array.from({length: MAX_SEARCH_TERMS + 3}, (_, i) => `w${i}`);
    const query = toFtsQuery(words.join(' '));

    expect(query?.split(' ')).toHaveLength(MAX_SEARCH_TERMS);
  });
});
