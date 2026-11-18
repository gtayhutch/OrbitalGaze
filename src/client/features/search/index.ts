/**
 * @fileoverview Public interface of the search feature.
 *
 * Layer: client feature (browser only).
 */
export {
  SearchDialog,
  SearchTrigger,
  useSearchShortcut,
  type SearchDialogProps,
  type SearchTriggerProps,
} from './search_dialog';
export {
  MIN_SEARCH_LENGTH,
  SEARCH_DEBOUNCE_MS,
  useCameraSearch,
  type CameraSearchState,
} from './use_camera_search';
