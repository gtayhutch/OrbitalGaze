/**
 * @fileoverview Converts a visitor's search text into a safe FTS5 query.
 *
 * Layer: worker service (server only; pure, no I/O).
 *
 * SQLite's full-text search has its own query language: `OR`, `NOT`, `NEAR`,
 * `*`, quotes, parentheses, and column filters such as `title:`. Passing a
 * visitor's text straight through would let them run arbitrary search
 * expressions (and make ordinary text containing those characters fail with
 * syntax errors). Instead, every word is wrapped in double quotes, which
 * FTS5 treats as plain text, and given a trailing `*` so partial words match
 * while the visitor is still typing ("tok" finds "Tokyo"). Words are
 * combined with AND, the FTS5 default.
 *
 * See https://www.sqlite.org/fts5.html#full_text_query_syntax
 */

/** Most words used from one query; extra words are ignored. */
export const MAX_SEARCH_TERMS = 8;

/**
 * A word is searchable only if it contains a letter or digit. Pure
 * punctuation would become an empty phrase, which FTS5 rejects.
 */
const SEARCHABLE_CHARACTER = /[\p{L}\p{N}]/u;

/**
 * Builds an FTS5 query that matches every word of `text` as a prefix.
 *
 * @param text The visitor's search text, already length-checked.
 * @returns The FTS5 query, or `null` if `text` has no searchable words.
 * @example
 * toFtsQuery('new york'); // '"new"* "york"*'
 * toFtsQuery('a OR b*');  // '"a"* "OR"* "b*"*' (OR is just a word here)
 * toFtsQuery('***');      // null
 */
export function toFtsQuery(text: string): string | null {
  const terms = text
    .split(/\s+/)
    // Skip words with nothing searchable in them.
    .filter(word => SEARCHABLE_CHARACTER.test(word))
    .slice(0, MAX_SEARCH_TERMS);

  if (terms.length === 0) {
    return null;
  }
  // Inside an FTS5 string, a double quote is escaped by doubling it.
  return terms.map(word => `"${word.replaceAll('"', '""')}"*`).join(' ');
}
