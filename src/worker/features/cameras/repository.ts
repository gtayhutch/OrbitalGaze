/**
 * @fileoverview All database access for cameras and their sources.
 *
 * Layer: worker repository (server only). Used by the camera routes and the
 * import service.
 *
 * Pattern: Repository. Every SQL statement about cameras lives here, so
 * routes and services never write SQL and the table layout can change in one
 * place. Each function:
 * - uses a prepared statement with bound parameters (never string-built SQL),
 * - caps how many rows it can return, and
 * - validates rows with a Zod schema before returning them, so a schema drift
 *   fails loudly instead of leaking bad data.
 *
 * The camera's feed location (`streamRef`) is read by no function here except
 * the writer: the public read queries don't even select it, so it can't leak
 * into an API response by mistake.
 */
import {z} from 'zod';

import {
  CameraCategorySchema,
  CameraDetailSchema,
  CameraIndexEntrySchema,
  CameraSearchResultSchema,
  type CameraCategory,
  type CameraDetail,
  type CameraIndexEntry,
  type CameraSearchResult,
} from '@/shared/cameras';

/**
 * Most cameras the globe index will ever contain in one response. A safety
 * cap well above today's catalog; the index moves to a prebuilt file before
 * the catalog gets near it.
 */
export const MAX_INDEX_ENTRIES = 50_000;

/** Most cameras one {@link CameraRepository.upsertCameras} call accepts. */
export const MAX_UPSERT_BATCH = 50;

/**
 * Most cameras one {@link CameraRepository.markStaleOffline} call changes.
 * The sweep runs hourly, so a larger backlog clears over a few runs.
 */
export const MAX_STALE_SWEEP = 1_000;

/** A camera's visibility; see the migration for what each value means. */
export type CameraStatus = 'online' | 'offline' | 'hidden';

/** A provider of cameras, as stored. */
export interface NewSource {
  readonly id: string;
  readonly name: string;
  readonly homepageUrl: string | null;
  readonly licenseName: string;
  readonly attributionText: string;
  readonly allowedHosts: readonly string[];
  readonly commercialUseAllowed: boolean;
}

/** A camera to store. */
export interface NewCamera {
  readonly id: string;
  readonly sourceId: string;
  readonly externalId: string;
  readonly title: string;
  readonly lat: number;
  readonly lng: number;
  readonly countryCode: string | null;
  readonly placeName: string | null;
  readonly timeZone: string | null;
  readonly category: CameraCategory;
  readonly streamType: 'hls' | 'youtube' | 'embed' | 'snapshot' | null;
  readonly streamRef: string | null;
  readonly status: CameraStatus;
}

/** Database-access functions for cameras. */
export interface CameraRepository {
  /** Every online camera's pin data, ordered by ID, capped at {@link MAX_INDEX_ENTRIES}. */
  listIndexEntries(): Promise<CameraIndexEntry[]>;
  /** One camera with its attribution, or `null` if it doesn't exist or is hidden. */
  findPublicById(id: string): Promise<CameraDetail | null>;
  /**
   * Full-text search over title, place, and category, best matches first.
   * Hidden cameras are excluded. `ftsQuery` must come from `toFtsQuery`.
   */
  searchByText(ftsQuery: string, limit: number): Promise<CameraSearchResult[]>;
  /** Stores a source. */
  insertSource(source: NewSource): Promise<void>;
  /** Stores cameras and their search entries together, atomically. */
  insertCameras(cameras: readonly NewCamera[]): Promise<void>;
  /** Creates a source, or updates its details if it already exists. */
  upsertSource(source: NewSource): Promise<void>;
  /**
   * Creates or updates imported cameras, matched on `(sourceId, externalId)`,
   * and stamps them as seen at `seenAt`. A camera someone hid stays hidden.
   * Search entries are rewritten only for cameras that are new or whose
   * searchable text changed. Accepts at most {@link MAX_UPSERT_BATCH}
   * cameras; everything is written in one transaction.
   *
   * @returns How many of the cameras were new.
   */
  upsertCameras(
    cameras: readonly NewCamera[],
    seenAt: string,
  ): Promise<{created: number}>;
  /**
   * Marks one source's online cameras that were last seen before `before` as
   * offline. Cameras that were never imported (no `lastSeenAt`) are left
   * alone. Changes at most {@link MAX_STALE_SWEEP} cameras per call.
   *
   * @returns How many cameras were marked offline.
   */
  markStaleOffline(sourceId: string, before: string): Promise<number>;
}

/** Row shape for the searchable fields of cameras being upserted. */
const SearchableRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  placeName: z.string().nullable(),
  category: z.string(),
});

/** Row shape for the detail query. SQLite returns booleans as 0 or 1. */
const DetailRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  lat: z.number(),
  lng: z.number(),
  countryCode: z.string().nullable(),
  placeName: z.string().nullable(),
  timeZone: z.string().nullable(),
  category: CameraCategorySchema,
  status: z.enum(['online', 'offline']),
  hasFeed: z.union([z.literal(0), z.literal(1)]),
  sourceName: z.string(),
  licenseName: z.string(),
  attributionText: z.string(),
  homepageUrl: z.string().nullable(),
});

/**
 * Creates a camera repository backed by a D1 database.
 *
 * @param db The D1 binding (`env.DB`).
 * @returns The repository.
 * @example
 * const cameras = createCameraRepository(c.env.DB);
 * const camera = await cameras.findPublicById('seed-0001');
 */
export function createCameraRepository(db: D1Database): CameraRepository {
  return {
    async listIndexEntries() {
      const {results} = await db
        .prepare(
          `SELECT id, lat, lng, category FROM cameras
           WHERE status = 'online'
           ORDER BY id
           LIMIT ?`,
        )
        .bind(MAX_INDEX_ENTRIES)
        .all();
      return z.array(CameraIndexEntrySchema).parse(results);
    },

    async findPublicById(id) {
      // `streamType IS NOT NULL` becomes hasFeed; the feed location itself is
      // not selected.
      const row = await db
        .prepare(
          `SELECT c.id, c.title, c.lat, c.lng, c.countryCode, c.placeName,
                  c.timeZone, c.category, c.status,
                  (c.streamType IS NOT NULL) AS hasFeed,
                  s.name AS sourceName, s.licenseName, s.attributionText,
                  s.homepageUrl
           FROM cameras AS c
           JOIN sources AS s ON s.id = c.sourceId
           WHERE c.id = ? AND c.status != 'hidden'
           LIMIT 1`,
        )
        .bind(id)
        .first();
      if (row === null) {
        return null;
      }
      const parsed = DetailRowSchema.parse(row);
      return CameraDetailSchema.parse({
        id: parsed.id,
        title: parsed.title,
        lat: parsed.lat,
        lng: parsed.lng,
        countryCode: parsed.countryCode,
        placeName: parsed.placeName,
        timeZone: parsed.timeZone,
        category: parsed.category,
        status: parsed.status,
        hasFeed: parsed.hasFeed === 1,
        attribution: {
          sourceName: parsed.sourceName,
          licenseName: parsed.licenseName,
          attributionText: parsed.attributionText,
          homepageUrl: parsed.homepageUrl,
        },
      });
    },

    async searchByText(ftsQuery, limit) {
      // FTS5 needs the table name (not an alias) on the left of MATCH.
      // `rank` orders by relevance, best first.
      const {results} = await db
        .prepare(
          `SELECT c.id, c.title, c.placeName, c.countryCode, c.category,
                  c.lat, c.lng
           FROM cameras_fts
           JOIN cameras AS c ON c.id = cameras_fts.cameraId
           WHERE cameras_fts MATCH ? AND c.status != 'hidden'
           ORDER BY cameras_fts.rank
           LIMIT ?`,
        )
        .bind(ftsQuery, limit)
        .all();
      return z.array(CameraSearchResultSchema).parse(results);
    },

    async insertSource(source) {
      await db
        .prepare(
          `INSERT INTO sources (id, name, homepageUrl, licenseName,
             attributionText, allowedHosts, commercialUseAllowed)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          source.id,
          source.name,
          source.homepageUrl,
          source.licenseName,
          source.attributionText,
          JSON.stringify(source.allowedHosts),
          source.commercialUseAllowed ? 1 : 0,
        )
        .run();
    },

    async insertCameras(cameras) {
      if (cameras.length === 0) {
        return;
      }
      const insertCamera = db.prepare(
        `INSERT INTO cameras (id, sourceId, externalId, title, lat, lng,
           countryCode, placeName, timeZone, category, streamType, streamRef,
           status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertSearchEntry = db.prepare(
        `INSERT INTO cameras_fts (cameraId, title, placeName, category)
         VALUES (?, ?, ?, ?)`,
      );
      // One batch runs as a single transaction: either every camera and its
      // search entry is stored, or none are.
      await db.batch(
        cameras.flatMap(camera => [
          insertCamera.bind(
            camera.id,
            camera.sourceId,
            camera.externalId,
            camera.title,
            camera.lat,
            camera.lng,
            camera.countryCode,
            camera.placeName,
            camera.timeZone,
            camera.category,
            camera.streamType,
            camera.streamRef,
            camera.status,
          ),
          insertSearchEntry.bind(
            camera.id,
            camera.title,
            camera.placeName,
            camera.category,
          ),
        ]),
      );
    },

    async upsertSource(source) {
      await db
        .prepare(
          `INSERT INTO sources (id, name, homepageUrl, licenseName,
             attributionText, allowedHosts, commercialUseAllowed)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET
             name = excluded.name,
             homepageUrl = excluded.homepageUrl,
             licenseName = excluded.licenseName,
             attributionText = excluded.attributionText,
             allowedHosts = excluded.allowedHosts,
             commercialUseAllowed = excluded.commercialUseAllowed,
             updatedAt = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
        )
        .bind(
          source.id,
          source.name,
          source.homepageUrl,
          source.licenseName,
          source.attributionText,
          JSON.stringify(source.allowedHosts),
          source.commercialUseAllowed ? 1 : 0,
        )
        .run();
    },

    async upsertCameras(cameras, seenAt) {
      if (cameras.length === 0) {
        return {created: 0};
      }
      if (cameras.length > MAX_UPSERT_BATCH) {
        throw new RangeError(
          `upsertCameras accepts at most ${MAX_UPSERT_BATCH} cameras.`,
        );
      }

      // Step 1: read what is stored now, to know which cameras are new and
      // which have new searchable text. Rewriting a search entry means
      // finding it by camera ID, which scans the search table, so it is
      // done only when something actually changed.
      const ids = cameras.map(camera => camera.id);
      const {results} = await db
        .prepare(
          `SELECT id, title, placeName, category FROM cameras
           WHERE id IN (${ids.map(() => '?').join(', ')})
           LIMIT ?`,
        )
        .bind(...ids, ids.length)
        .all();
      const existing = new Map(
        z
          .array(SearchableRowSchema)
          .parse(results)
          .map(row => [row.id, row]),
      );

      // Step 2: one upsert per camera. On a repeat import, the provider's
      // fields are refreshed, the camera is stamped as seen, and its failure
      // count resets. A hidden camera keeps its hidden status.
      const upsertCamera = db.prepare(
        `INSERT INTO cameras (id, sourceId, externalId, title, lat, lng,
           countryCode, placeName, timeZone, category, streamType, streamRef,
           status, lastCheckedAt, lastSeenAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (sourceId, externalId) DO UPDATE SET
           title = excluded.title,
           lat = excluded.lat,
           lng = excluded.lng,
           countryCode = excluded.countryCode,
           placeName = excluded.placeName,
           timeZone = excluded.timeZone,
           category = excluded.category,
           streamType = excluded.streamType,
           streamRef = excluded.streamRef,
           status = CASE WHEN cameras.status = 'hidden' THEN 'hidden'
                         ELSE excluded.status END,
           lastCheckedAt = excluded.lastCheckedAt,
           lastSeenAt = excluded.lastSeenAt,
           consecutiveFailures = 0,
           updatedAt = excluded.lastSeenAt`,
      );
      const deleteSearchEntry = db.prepare(
        'DELETE FROM cameras_fts WHERE cameraId = ?',
      );
      const insertSearchEntry = db.prepare(
        `INSERT INTO cameras_fts (cameraId, title, placeName, category)
         VALUES (?, ?, ?, ?)`,
      );

      let created = 0;
      const statements: D1PreparedStatement[] = [];
      for (const camera of cameras) {
        statements.push(
          upsertCamera.bind(
            camera.id,
            camera.sourceId,
            camera.externalId,
            camera.title,
            camera.lat,
            camera.lng,
            camera.countryCode,
            camera.placeName,
            camera.timeZone,
            camera.category,
            camera.streamType,
            camera.streamRef,
            camera.status,
            seenAt,
            seenAt,
          ),
        );
        // Step 3: keep the search table in step, only where needed.
        const stored = existing.get(camera.id);
        const searchTextChanged =
          stored !== undefined &&
          (stored.title !== camera.title ||
            stored.placeName !== camera.placeName ||
            stored.category !== camera.category);
        if (stored === undefined) {
          created++;
        } else if (searchTextChanged) {
          statements.push(deleteSearchEntry.bind(camera.id));
        }
        if (stored === undefined || searchTextChanged) {
          statements.push(
            insertSearchEntry.bind(
              camera.id,
              camera.title,
              camera.placeName,
              camera.category,
            ),
          );
        }
      }
      // One batch is one transaction: the cameras and their search entries
      // are written together or not at all.
      await db.batch(statements);
      return {created};
    },

    async markStaleOffline(sourceId, before) {
      // The subquery bounds how many rows one sweep can touch.
      const result = await db
        .prepare(
          `UPDATE cameras
           SET status = 'offline',
               updatedAt = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
           WHERE id IN (
             SELECT id FROM cameras
             WHERE sourceId = ? AND status = 'online'
               AND lastSeenAt IS NOT NULL AND lastSeenAt < ?
             LIMIT ?
           )`,
        )
        .bind(sourceId, before, MAX_STALE_SWEEP)
        .run();
      return result.meta.changes;
    },
  };
}
