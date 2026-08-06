// Query-key namespaces for the study-list and study-drawer react-query caches.
//
// These live in a LEAF module, imported by the hooks that define the queries AND by everything
// that needs to invalidate them. That separation is load-bearing, not tidiness:
// `useSeriesMetadata` imports `extensionManager` from `../App`, so importing the constant from
// there drags the entire application graph — App -> every registered extension -> back into
// partially-initialized viewer modules — in behind it. Once the cornerstone extension's toolbar
// began importing the removal hook, that closed a cycle and the viewer failed to boot with
// "Cannot access 'components' before initialization" from an unrelated extension panel.
//
// Anything importable from an extension must stay clear of `../App`. Keep it that way.

/** Study-list rows (useStudies). Every other element of that key is a filter, page or sort. */
export const STUDY_LIST_QUERY_KEY = 'studyList';

/** Study-drawer series metadata (useSeriesMetadata), keyed per server and study beneath this. */
export const SERIES_METADATA_QUERY_KEY = 'seriesMetadata';
