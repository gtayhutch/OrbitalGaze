/**
 * @fileoverview The camera import: planning, importing pages, and finishing.
 *
 * Layer: worker feature service (server only). Called by the jobs in
 * `src/worker/jobs/`, which read the bindings and pass them in.
 *
 * The nightly import has three steps:
 * 1. **Plan** ({@link planWindyImport}): one queue message per page of the
 *    1,050 most popular Windy webcams (21 pages of 50).
 * 2. **Import** ({@link importWindyPage}): the queue consumer fetches one
 *    page from Windy and upserts its cameras.
 * 3. **Finish** ({@link finalizeImport}), hourly: cameras not seen for 48
 *    hours go offline, and the camera index file in R2 is rebuilt if the
 *    set of pins changed.
 *
 * Every step is safe to run twice (queues can deliver a message more than
 * once): imports upsert on the provider's ID, and the finish step only
 * compares and overwrites.
 */
import {z} from 'zod';

import type {CameraIndex} from '@/shared/cameras';

import type {CameraRepository} from './repository';
import {
  toNewCamera,
  WINDY_SOURCE,
  WINDY_SOURCE_ID,
} from './sources/windy/adapter';
import type {WindyClient} from './sources/windy/client';

/** Webcams per Windy request (Windy's maximum). */
export const WINDY_IMPORT_PAGE_SIZE = 50;

/**
 * The largest list offset Windy accepts on our API tier. The free tier
 * answers a higher offset with HTTP 400 ("Offset is over API tier limit
 * 1000!", checked 2026-11-18); the professional tier allows 10,000. Raise
 * this if the plan changes.
 */
export const WINDY_TIER_MAX_OFFSET = 1_000;

/**
 * How many of Windy's most popular webcams are imported: every page up to
 * and including the tier's last offset.
 */
export const WINDY_IMPORT_MAX_CAMERAS =
  WINDY_TIER_MAX_OFFSET + WINDY_IMPORT_PAGE_SIZE;

/** An imported camera not seen for this long is marked offline. */
export const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

/** Where the camera index file lives in the `CAMERA_INDEX` bucket. */
export const CAMERA_INDEX_OBJECT_KEY = 'camera-index/v1.json';

/** Largest page offset the plan creates. */
const MAX_OFFSET = WINDY_IMPORT_MAX_CAMERAS - WINDY_IMPORT_PAGE_SIZE;

/** A queue message asking the consumer to import one page from Windy. */
export const IngestMessageSchema = z.object({
  kind: z.literal('windy-page'),
  /** The import run, as its UTC date, for logs. */
  runId: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  offset: z
    .number()
    .int()
    .min(0)
    .max(MAX_OFFSET)
    .multipleOf(WINDY_IMPORT_PAGE_SIZE),
});

/** One page-import request. */
export type IngestMessage = z.infer<typeof IngestMessageSchema>;

/**
 * Formats a time the way the database stores timestamps (ISO 8601 UTC to
 * the second), so stored values compare correctly as text.
 *
 * @param date The time.
 * @returns For example `2026-11-17T03:00:00Z`.
 */
export function toDbTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Lists the page imports for one nightly run.
 *
 * @param now When the run starts; its UTC date becomes the run ID.
 * @returns One message per page, offsets 0 to 1,000.
 * @example
 * planWindyImport(new Date('2026-11-18T03:00:00Z')).length; // 21
 */
export function planWindyImport(now: Date): IngestMessage[] {
  const runId = now.toISOString().slice(0, 10);
  const messages: IngestMessage[] = [];
  for (let offset = 0; offset <= MAX_OFFSET; offset += WINDY_IMPORT_PAGE_SIZE) {
    messages.push({kind: 'windy-page', runId, offset});
  }
  return messages;
}

/** What one page import did. */
export interface PageImportResult {
  /** Cameras written (new or updated). */
  readonly imported: number;
  /** Of those, how many were new. */
  readonly created: number;
  /** Webcams Windy sent that failed validation and were dropped. */
  readonly skipped: number;
}

/**
 * Imports one page of Windy webcams.
 *
 * @param deps The Windy client, the camera repository, and the current time.
 * @param message Which page to import.
 * @returns Counts for the log.
 * @throws {OutboundError} When Windy can't be reached or answers badly; the
 *     queue consumer decides whether to retry.
 */
export async function importWindyPage(
  deps: {windy: WindyClient; cameras: CameraRepository; now: Date},
  message: IngestMessage,
): Promise<PageImportResult> {
  // Step 1: make sure the source exists (and has the current credit text)
  // before any camera points at it.
  await deps.cameras.upsertSource(WINDY_SOURCE);

  // Step 2: fetch and convert the page. A webcam can appear twice if the
  // ranking shifts mid-page, so keep one per ID.
  const page = await deps.windy.listPopularWebcams({
    offset: message.offset,
    limit: WINDY_IMPORT_PAGE_SIZE,
  });
  const byId = new Map(
    page.webcams.map(webcam => {
      const camera = toNewCamera(webcam);
      return [camera.id, camera] as const;
    }),
  );
  const cameras = [...byId.values()];

  // Step 3: store them, stamped as seen now.
  const {created} = await deps.cameras.upsertCameras(
    cameras,
    toDbTimestamp(deps.now),
  );
  return {imported: cameras.length, created, skipped: page.skipped};
}

/** What one finish step did. */
export interface FinalizeResult {
  /** Cameras marked offline because Windy stopped listing them. */
  readonly markedOffline: number;
  /** Online cameras in the index. */
  readonly indexedCameras: number;
  /** False when the index was already up to date. */
  readonly indexWritten: boolean;
}

/**
 * Hashes the pin list, to tell whether the index file needs rewriting.
 *
 * @param text The serialized pin list.
 * @returns The SHA-256 hash as hex.
 */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Marks stale imported cameras offline and rebuilds the camera index file.
 *
 * @param deps The camera repository, the index bucket, and the current time.
 * @returns Counts for the log.
 */
export async function finalizeImport(deps: {
  cameras: CameraRepository;
  bucket: R2Bucket;
  now: Date;
}): Promise<FinalizeResult> {
  // Step 1: cameras Windy hasn't listed for two nightly runs go offline.
  const staleBefore = toDbTimestamp(
    new Date(deps.now.getTime() - STALE_AFTER_MS),
  );
  const markedOffline = await deps.cameras.markStaleOffline(
    WINDY_SOURCE_ID,
    staleBefore,
  );

  // Step 2: rebuild the index, but skip the write if the pins are unchanged.
  // The hash is stored with the file, so the check costs one metadata read.
  const entries = await deps.cameras.listIndexEntries();
  const hash = await sha256Hex(JSON.stringify(entries));
  const current = await deps.bucket.head(CAMERA_INDEX_OBJECT_KEY);
  if (current?.customMetadata?.hash === hash) {
    return {markedOffline, indexedCameras: entries.length, indexWritten: false};
  }
  const index: CameraIndex = {
    generatedAt: deps.now.toISOString(),
    cameras: entries,
  };
  await deps.bucket.put(
    CAMERA_INDEX_OBJECT_KEY,
    JSON.stringify({data: index}),
    {
      httpMetadata: {contentType: 'application/json; charset=UTF-8'},
      customMetadata: {hash},
    },
  );
  return {markedOffline, indexedCameras: entries.length, indexWritten: true};
}
