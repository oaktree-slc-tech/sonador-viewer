// The Annotations panel's "Landmarks" group: one row per landmark set of the loaded documents
// (core DICOMSR/landmarks), whatever kind of document holds it. A set is read-only: its row has no
// actions, and it is never saved. Placement and series attribution are read on every build, so the
// row follows the display sets as they are added and removed: a series is loaded while a display set
// shows it, and its geometry comes from the metadata cache.

import OHIF, { DicomMetadataStore } from '@ohif/core';

export const LANDMARK_SET_TOOL = 'SonadorLandmarkSet';
export const LANDMARKS_GROUP_ID = 'landmarks';
const LANDMARKS_GROUP_NAME = 'Landmarks';
const UNNAMED_SET = 'Landmark set';

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

/** The panel row of a landmark-set entry ({ key, set, document }) */
export function landmarkSetRow(entry, { store = DicomMetadataStore, displaySets = activeDisplaySets() } = {}) {
  const { key, set, document } = entry;
  const api = landmarks();
  const placement = api.placementOf(set, store, displaySets);
  const { groupSeriesInstanceUID } = api.attributionOf(set, document, store);
  return {
    measurementId: key,
    toolType: LANDMARK_SET_TOOL,
    trackingIdentifier: set.trackingIdentifier,
    label: labelLineOf(set),
    description: set.description || undefined,
    isReadOnly: true,
    isLocked: true,
    isPending: false,
    fromApplicationDocument: document.kind === 'application',
    isVisible: true,
    data: [{ displayText: set.name || UNNAMED_SET }],
    refStudyInstanceUID: document.StudyInstanceUID,
    refSeriesInstanceUID: groupSeriesInstanceUID || undefined,
    landmarkSet: {
      key,
      count: set.landmarks.length,
      domain: set.domain,
      documentKind: document.kind,
      placed: placement.placed,
      note: placement.note,
      sourceSeries: set.sourceSeries || undefined,
    },
  };
}

/** The Landmarks group of the panel, or null when no document holds a set */
export function landmarksGroup(options) {
  const api = landmarks();
  const entries = api ? api.getLandmarkSets() : [];
  if (!entries.length) {
    return null;
  }
  return {
    groupName: LANDMARKS_GROUP_NAME,
    groupId: LANDMARKS_GROUP_ID,
    toolGroupId: LANDMARKS_GROUP_ID,
    measurements: entries.map(entry => landmarkSetRow(entry, options)),
  };
}

/** Whether a panel row is a landmark set's */
export const isLandmarkSetRow = row => Boolean(row && row.landmarkSet);
