/**
 * @fileoverview Shapes of the Windy Webcams API (v3) responses we use.
 *
 * Layer: worker feature, Windy source (server only).
 *
 * Windy's data crosses a trust boundary, so it is validated like any other
 * input. Each schema lists only the fields the app reads; Zod drops the
 * rest. List pages are checked in two steps: the page shape first, then
 * each webcam on its own, so one malformed webcam is skipped instead of
 * failing the whole page.
 *
 * Reference: https://api.windy.com/webcams/docs
 */
import {z} from 'zod';

/** Most webcams one list request may return (Windy's own maximum). */
export const WINDY_MAX_PAGE_SIZE = 50;

/** One category tag on a webcam, for example `{id: 'beach'}`. */
const WindyCategorySchema = z.object({
  id: z.string().min(1).max(50),
});

/** Where a webcam is. Text fields are optional in practice. */
const WindyLocationSchema = z.object({
  city: z.string().nullish(),
  region: z.string().nullish(),
  country_code: z.string().nullish(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

/** One webcam as returned with `include=categories,location`. */
export const WindyWebcamSchema = z.object({
  webcamId: z.number().int().positive(),
  title: z.string().trim().min(1),
  /** `active` (updated in the last 24 hours) or `inactive`. */
  status: z.string(),
  categories: z.array(WindyCategorySchema).max(20).optional(),
  location: WindyLocationSchema,
});

/** One webcam, validated. */
export type WindyWebcam = z.infer<typeof WindyWebcamSchema>;

/** The outer shape of a list page; webcams are validated separately. */
export const WindyListPageSchema = z.object({
  total: z.number().int().nonnegative().optional(),
  webcams: z.array(z.unknown()).max(WINDY_MAX_PAGE_SIZE),
});
