/**
 * @fileoverview Structured JSON logging for the Worker.
 *
 * Layer: worker library (server only).
 *
 * Cloudflare Workers Logs indexes JSON written to the console, so each log
 * line is one JSON object with a level, a message, and searchable fields.
 * Every request gets its own logger carrying the request ID, so all lines for
 * one request can be found together.
 *
 * Never log secrets, tokens, full URLs with query strings, or personal data.
 * Log IDs and categories instead.
 */

/** Severity of a log entry. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Extra searchable fields attached to a log entry. Values must be JSON-safe. */
export type LogFields = Readonly<
  Record<string, string | number | boolean | null>
>;

/** Writes structured log entries that share a set of base fields. */
export interface Logger {
  /** Detailed information for local debugging. */
  debug(message: string, fields?: LogFields): void;
  /** Normal events worth recording, such as a completed request. */
  info(message: string, fields?: LogFields): void;
  /** Something unexpected that the Worker recovered from. */
  warn(message: string, fields?: LogFields): void;
  /** A failure that needs attention. */
  error(message: string, fields?: LogFields): void;
}

/** A function that receives one finished log line; injectable for tests. */
export type LogSink = (line: string) => void;

/** The default sink: the console, which Workers Logs collects. */
function writeToConsole(line: string): void {
  console.log(line);
}

/**
 * Creates a logger whose entries all include `baseFields`.
 *
 * @param baseFields Fields added to every entry, such as the request ID.
 * @param sink Where finished lines go. Defaults to the console.
 * @returns A logger.
 * @example
 * const logger = createLogger({requestId});
 * logger.info('request completed', {status: 200, durationMs: 12});
 * // {"level":"info","message":"request completed","requestId":"…","status":200,"durationMs":12}
 */
export function createLogger(
  baseFields: LogFields,
  sink: LogSink = writeToConsole,
): Logger {
  /** Serializes one entry. Base fields come first; per-call fields may override them. */
  const write = (
    level: LogLevel,
    message: string,
    fields: LogFields = {},
  ): void => {
    sink(JSON.stringify({level, message, ...baseFields, ...fields}));
  };
  return {
    debug: (message, fields) => {
      write('debug', message, fields);
    },
    info: (message, fields) => {
      write('info', message, fields);
    },
    warn: (message, fields) => {
      write('warn', message, fields);
    },
    error: (message, fields) => {
      write('error', message, fields);
    },
  };
}
