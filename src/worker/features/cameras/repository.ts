/**
 * @fileoverview All database access for cameras and their sources.
 *
 * Layer: worker repository (server only). Used by the camera routes and,
 * later, by ingestion jobs.
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
}

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
  };
}
