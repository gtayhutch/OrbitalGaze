/**
 * @fileoverview Camera shapes shared by the API and the browser app.
 *
 * Layer: shared (no I/O).
 *
 * These schemas are the public contract for camera data. They deliberately
 * leave out anything server-only: in particular a camera's feed location is
 * never sent to browsers. The detail shape says only whether a feed exists
 * (`hasFeed`), and viewing it will go through the server.
 */
import {z} from 'zod';

/** What a camera shows; used for the category filters and pin colors. */
export const CAMERA_CATEGORIES = [
  'city',
  'nature',
  'traffic',
  'weather',
  'landmark',
  'beach',
  'other',
] as const;

/** Validates a category against {@link CAMERA_CATEGORIES}. */
export const CameraCategorySchema = z.enum(CAMERA_CATEGORIES);

/** One of the categories in {@link CAMERA_CATEGORIES}. */
export type CameraCategory = z.infer<typeof CameraCategorySchema>;

/**
 * Camera IDs: letters, digits, and hyphens, 1 to 64 characters. This covers
 * UUIDs and the synthetic `seed-0001` style. Anything else is rejected before
 * it reaches the database.
 */
export const CameraIdSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9-]{1,64}$/,
    'Camera IDs contain only letters, digits, and hyphens.',
  );

/** Latitude in decimal degrees (WGS 84), -90 to 90. */
const LatitudeSchema = z.number().min(-90).max(90);

/** Longitude in decimal degrees (WGS 84), -180 to 180. */
const LongitudeSchema = z.number().min(-180).max(180);

/** The minimum the globe needs to draw one pin. */
export const CameraIndexEntrySchema = z.object({
  id: CameraIdSchema,
  lat: LatitudeSchema,
  lng: LongitudeSchema,
  category: CameraCategorySchema,
});

/** One pin on the globe. */
export type CameraIndexEntry = z.infer<typeof CameraIndexEntrySchema>;

/** Body of `GET /api/v1/cameras/index` (inside the `data` envelope). */
export const CameraIndexSchema = z.object({
  /** When the index was built, as an ISO 8601 UTC timestamp. */
  generatedAt: z.string(),
  cameras: z.array(CameraIndexEntrySchema),
});

/** The set of pins for the globe. */
export type CameraIndex = z.infer<typeof CameraIndexSchema>;

/** Who provides a camera, and the credit and license that must be shown. */
export const CameraAttributionSchema = z.object({
  sourceName: z.string(),
  licenseName: z.string(),
  attributionText: z.string(),
  homepageUrl: z.string().nullable(),
});

/** Attribution for one camera. */
export type CameraAttribution = z.infer<typeof CameraAttributionSchema>;

/** Statuses a public camera can have. Hidden cameras are never returned. */
export const PublicCameraStatusSchema = z.enum(['online', 'offline']);

/** Everything the detail panel shows about one camera. */
export const CameraDetailSchema = z.object({
  id: CameraIdSchema,
  title: z.string(),
  lat: LatitudeSchema,
  lng: LongitudeSchema,
  countryCode: z.string().nullable(),
  placeName: z.string().nullable(),
  /** IANA time zone, for showing the camera's local time. */
  timeZone: z.string().nullable(),
  category: CameraCategorySchema,
  status: PublicCameraStatusSchema,
  /** Whether a live view or snapshot exists for this camera. */
  hasFeed: z.boolean(),
  attribution: CameraAttributionSchema,
});

/** One camera, as shown in the detail panel. */
export type CameraDetail = z.infer<typeof CameraDetailSchema>;

/** One search hit: enough to list it and fly the globe to it. */
export const CameraSearchResultSchema = z.object({
  id: CameraIdSchema,
  title: z.string(),
  placeName: z.string().nullable(),
  countryCode: z.string().nullable(),
  category: CameraCategorySchema,
  lat: LatitudeSchema,
  lng: LongitudeSchema,
});

/** One search hit. */
export type CameraSearchResult = z.infer<typeof CameraSearchResultSchema>;

/** Longest search text accepted, in characters. */
export const MAX_SEARCH_QUERY_LENGTH = 100;

/** Most results one search returns. */
export const MAX_SEARCH_RESULTS = 20;

/** Body of `GET /api/v1/cameras/search` (inside the `data` envelope). */
export const CameraSearchResponseSchema = z.object({
  results: z.array(CameraSearchResultSchema).max(MAX_SEARCH_RESULTS),
});

/** Search results. */
export type CameraSearchResponse = z.infer<typeof CameraSearchResponseSchema>;
