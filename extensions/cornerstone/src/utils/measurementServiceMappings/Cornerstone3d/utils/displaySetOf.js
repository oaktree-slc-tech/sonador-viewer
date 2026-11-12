// The display set of a measurement's image, else of its series. A report can be read before the
// display set of the series it measures lists its instances (a study reload), or without one: the
// measurement is then mapped without a display set rather than not at all.

const NO_DISPLAY_SET = Object.freeze({ instances: Object.freeze([]), images: Object.freeze([]), isMultiFrame: false });

/**
 * @param {object} displaySetService
 * @param {string} [SOPInstanceUID]
 * @param {string} [SeriesInstanceUID]
 * @returns {object} the display set, or an empty one (no `displaySetInstanceUID`, no instances)
 */
export default function displaySetOf(displaySetService, SOPInstanceUID, SeriesInstanceUID) {
  const byInstance = SOPInstanceUID
    ? displaySetService.getDisplaySetForSOPInstanceUID(SOPInstanceUID, SeriesInstanceUID) : undefined;
  const bySeries = SeriesInstanceUID ? (displaySetService.getDisplaySetsForSeries(SeriesInstanceUID) || [])[0] : undefined;
  return byInstance || bySeries || NO_DISPLAY_SET;
}

export { displaySetOf, NO_DISPLAY_SET };
