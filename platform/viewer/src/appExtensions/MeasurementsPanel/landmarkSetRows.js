// The Annotations panel's "Landmarks" group: one row per landmark set of the loaded documents
// (core DICOMSR/landmarks), whatever kind of document holds it. A set is read-only: its row has no
// actions, and it is never saved. Placement and series attribution are read on every build, so the
// row follows the display sets as they are added and removed: a series is loaded while a display set
// shows it, and its geometry comes from the metadata cache. The row also carries what its card lists
// (its landmarks, meta, reference and appearance) and the session's view of the set: whether it is
// shown and, while it holds the current landmark, that landmark's position.

import OHIF, { DicomMetadataStore } from '@ohif/core';

export const LANDMARK_SET_TOOL = 'SonadorLandmarkSet';
export const LANDMARKS_GROUP_ID = 'landmarks';
const LANDMARKS_GROUP_NAME = 'Landmarks';
// A set or landmark that stores no colour is drawn in the Viewer's default
export const LANDMARK_DEFAULT_COLOR = '#FFFF00';

const landmarks = () => OHIF.DICOMSR && OHIF.DICOMSR.landmarks;

/** The active display sets, or undefined when the display set service is not available */
function activeDisplaySets() {
  const api = OHIF.display && OHIF.display.DisplaySetApi && OHIF.display.DisplaySetApi.Instance;
  const service = api && api.displaySetService;
  return service ? service.activeDisplaySets || [] : undefined;
}

/** The label line of a set: its label when a concept names it, then its description */
function labelLineOf(set) {
  const parts = [set.concept ? set.label : null, set.description].filter(Boolean);
  return parts.join(' / ');
}

const seriesNumberOf = series => (series && (series.SeriesNumber !== undefined ? series.SeriesNumber
  : ((series.instances || [])[0] || {}).SeriesNumber));

/** The frame a placed patient-domain set is in, named by the loaded series it is the frame of */
function frameTextOf(set, placement, seriesInstanceUID) {
  if (set.domain !== 'patient' || !placement.placed || !placement.series.length) {
    return undefined;
  }
  const series = placement.series.find(candidate => candidate.SeriesInstanceUID === seriesInstanceUID) || placement.series[0];
  const number = seriesNumberOf(series);
  return number !== undefined && number !== null && number !== '' ? `Imaging frame of series ${number}` : undefined;
}

/** A landmark as the row and the card list it */
function landmarkItemOf(api, set, landmark, index) {
  const colors = api.landmarkColors(set, landmark);
  const own = api.ownColorRoles(landmark);
  return {
    index,
    ordinal: landmark.ordinal,
    name: landmark.name || null,
    detail: api.landmarkDetailOf(landmark),
    shape: api.markerShapeOf(landmark),
    typeText: api.typeTextOf(landmark),
    line: colors.Line || LANDMARK_DEFAULT_COLOR,
    text: colors.Text || LANDMARK_DEFAULT_COLOR,
    own: { Line: own.Line ? landmark.display.Line : null, Text: own.Text ? landmark.display.Text : null },
  };
}

/** The appearance of a set: its colours by role and the landmarks that set their own; null when none does */
function appearanceOf(set, items) {
  const stored = landmarks().setColors(set);
  const overrides = items.filter(item => item.own.Line || item.own.Text)
    .map(item => ({ ordinal: item.ordinal, line: item.own.Line, text: item.own.Text }));
  if (!stored.Line && !stored.Text && !overrides.length) {
    return null;
  }
  return {
    line: stored.Line || LANDMARK_DEFAULT_COLOR,
    text: stored.Text || LANDMARK_DEFAULT_COLOR,
    overrides,
  };
}

/** The panel row of a landmark-set entry ({ key, set, document }) */
export function landmarkSetRow(entry, { store = DicomMetadataStore, displaySets = activeDisplaySets() } = {}) {
  const { key, set, document } = entry;
  const api = landmarks();
  const placement = api.placementOf(set, store, displaySets);
  const { seriesInstanceUID, groupSeriesInstanceUID } = api.attributionOf(set, document, store);
  const stored = api.setColors(set);
  const items = set.landmarks.map((landmark, index) => landmarkItemOf(api, set, landmark, index));
  const current = api.getCurrentLandmark();
  const position = current && current.key === key ? current.index : null;
  const measurementApi = OHIF.measurements && OHIF.measurements.MeasurementApi && OHIF.measurements.MeasurementApi.Instance;
  return {
    measurementId: key,
    timepointId: measurementApi && typeof measurementApi.timepointIdOf === 'function' ? measurementApi.timepointIdOf(entry) : undefined,
    toolType: LANDMARK_SET_TOOL,
    trackingIdentifier: set.trackingIdentifier,
    label: labelLineOf(set),
    description: set.description || undefined,
    isReadOnly: true,
    isLocked: true,
    isPending: false,
    fromApplicationDocument: document.kind === 'application',
    isVisible: api.isLandmarkSetVisible(key),
    data: [{ displayText: api.setNameOf(set) }],
    refStudyInstanceUID: document.StudyInstanceUID,
    refSeriesInstanceUID: groupSeriesInstanceUID || undefined,
    // An image-domain set names its image on the reference line
    refSOPInstanceUID: set.domain === 'image' && set.image ? set.image.sopInstanceUID : undefined,
    landmarkSet: {
      key,
      name: set.name || '',
      count: set.landmarks.length,
      namedCount: items.filter(item => item.name).length,
      domain: set.domain,
      frameNumber: set.domain === 'image' && set.image ? set.image.frameNumber : undefined,
      documentKind: document.kind,
      placed: placement.placed,
      note: placement.note,
      sourceSeries: set.sourceSeries || undefined,
      colors: { line: stored.Line || LANDMARK_DEFAULT_COLOR, text: stored.Text || LANDMARK_DEFAULT_COLOR },
      landmarks: items,
      position,
      concept: set.concept ? { meaning: set.concept.meaning, value: set.concept.value, scheme: set.concept.schemeDesignator } : null,
      label: set.label || null,
      description: set.description || null,
      frame: frameTextOf(set, placement, seriesInstanceUID),
      types: api.typeBreakdownOf(set),
      appearance: appearanceOf(set, items),
    },
  };
}

// Landmark sets answer the global visibility as the other annotations do: the store registers with
// the session's visibility rule in core (DICOMSR/landmarks/landmarkSetStore.js), which Show all, Hide
// all and the all-hidden query read and write through the Measurements API. Kept for callers of the
// earlier registration; it registers nothing.
export function registerLandmarkVisibilitySource() {}

/**
 * The Landmarks group of the panel, or null when no document holds a set
 *
 * @param {object} [options] - { store, displaySets } for the rows; { activeTimepointId }: only the
 *   sets of this timepoint are listed (every set when absent)
 */
export function landmarksGroup(options = {}) {
  const api = landmarks();
  const { activeTimepointId, ...rowOptions } = options || {};
  const measurementApi = OHIF.measurements && OHIF.measurements.MeasurementApi && OHIF.measurements.MeasurementApi.Instance;
  const inTimepoint = entry => !activeTimepointId || !measurementApi || typeof measurementApi.timepointIdOf !== 'function'
    || measurementApi.timepointIdOf(entry) === activeTimepointId;
  const entries = api ? api.getLandmarkSets().filter(inTimepoint) : [];
  if (!entries.length) {
    return null;
  }
  return {
    groupName: LANDMARKS_GROUP_NAME,
    groupId: LANDMARKS_GROUP_ID,
    toolGroupId: LANDMARKS_GROUP_ID,
    measurements: entries.map(entry => landmarkSetRow(entry, Object.keys(rowOptions).length ? rowOptions : undefined)),
  };
}

/** Whether a panel row is a landmark set's */
export const isLandmarkSetRow = row => Boolean(row && row.landmarkSet);
