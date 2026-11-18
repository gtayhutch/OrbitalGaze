/**
 * @fileoverview Display names and colors for camera categories.
 *
 * Layer: client feature (browser only). Used by the layer panel, the detail
 * panel, and the globe's pins, so a category looks the same everywhere.
 *
 * Colors are chosen to stand out against both the dark sky and the globe's
 * imagery. Color is never the only signal: the layer panel and detail panel
 * always show the category name next to it.
 */
import type {CameraCategory} from '@/shared/cameras';

/** How one category is presented. */
export interface CategoryStyle {
  /** Name shown to people, for example "Traffic". */
  readonly label: string;
  /** Pin and swatch color, as a CSS hex color. */
  readonly color: string;
}

/** Presentation for every category, in the order the filters list them. */
export const CATEGORY_STYLES: Readonly<Record<CameraCategory, CategoryStyle>> =
  {
    city: {label: 'City', color: '#60a5fa'},
    landmark: {label: 'Landmark', color: '#f472b6'},
    nature: {label: 'Nature', color: '#4ade80'},
    beach: {label: 'Beach', color: '#22d3ee'},
    weather: {label: 'Weather', color: '#a78bfa'},
    traffic: {label: 'Traffic', color: '#fbbf24'},
    other: {label: 'Other', color: '#94a3b8'},
  };
