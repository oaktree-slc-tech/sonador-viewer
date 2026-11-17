// Navigation to the landmarks of a set from the Annotations panel. Selecting a set's row steps
// through its landmarks (the first, then the next, the first again after the last); choosing a named
// landmark from the set's card makes it the current one. The current landmark is the session's
// (core DICOMSR/landmarks), so the renderers read it from there. Only a placed set navigates; the
// selection of a hidden set still moves.
//
// The viewport goes to the landmark's own coordinates:
// - in the classic viewport, to the image within half a slice spacing of it, in the stack shown
//   first, then the series the set is attributed to, then the other loaded series of its frame
//   (cornerstone extension `jumpToLandmark`). When no stack holds it, the image stays.
// - in the MPR view, the panes move to it when the view shows a series of its frame
//   (vtk extension `jumpToMprWorldPoint`).
// An image-domain set goes to its image and frame in the classic viewport; in the MPR view the panes
// move to the landmark's patient position when its image has patient geometry.

import OHIF, { DicomMetadataStore } from '@ohif/core';

import { isMprActive } from './mprMeasurementNavigation';

const landmarks = () => OHIF.DICOMSR.landmarks;

/** The active display sets, or undefined when the display set service is not available */
function activeDisplaySets() {
  const api = OHIF.display && OHIF.display.DisplaySetApi && OHIF.display.DisplaySetApi.Instance;
  const service = api && api.displaySetService;
  return service ? service.activeDisplaySets || [] : undefined;
}

/** The first `length` numbers of a multi-valued attribute, or undefined when one is missing or blank */
const numbers = (values, length) => {
  const list = Array.isArray(values) ? values : String(values === undefined || values === null ? '' : values).split('\\');
  const parts = list.slice(0, length);
  if (parts.length < length || parts.some(part => part === null || part === undefined || String(part).trim() === '')) {
    return undefined;
  }
  const parsed = parts.map(Number);
  return parsed.every(Number.isFinite) ? parsed : undefined;
};

/**
 * The patient position of an image-domain point ([column, row], the top left corner of the top left
 * pixel at 0, 0) on an instance with patient geometry; undefined without it
 */
function patientPointOfImagePoint(instance, point) {
  const origin = numbers(instance && instance.ImagePositionPatient, 3);
  const orientation = numbers(instance && instance.ImageOrientationPatient, 6);
  const spacing = numbers(instance && instance.PixelSpacing, 2);
  if (!origin || !orientation || !spacing || !point) {
    return undefined;
  }
  // The origin is the centre of the first pixel; the first direction runs along a row (columns)
  const [column, row] = point.map(Number);
  const across = (column - 0.5) * spacing[1];
  const down = (row - 0.5) * spacing[0];
  return [0, 1, 2].map(axis => origin[axis] + orientation[axis] * across + orientation[axis + 3] * down);
}

/** The Frame of Reference of a loaded series, from its first instance that names one */
function frameOfReferenceOfSeries(store, StudyInstanceUID, SeriesInstanceUID) {
  const series = StudyInstanceUID && SeriesInstanceUID && typeof store.getSeries === 'function'
    ? store.getSeries(StudyInstanceUID, SeriesInstanceUID) : undefined;
  const instance = ((series && series.instances) || []).find(candidate => candidate && candidate.FrameOfReferenceUID);
  return instance ? instance.FrameOfReferenceUID : undefined;
}

/** The Frame of Reference the MPR view shows: that of the series of its active viewport */
function mprFrameOfReference(viewportsState, store) {
  const activeViewportIndex = (viewportsState && viewportsState.activeViewportIndex) || 0;
  const shown = ((viewportsState && viewportsState.viewportSpecificData) || {})[activeViewportIndex] || {};
  return frameOfReferenceOfSeries(store, shown.StudyInstanceUID, shown.SeriesInstanceUID);
}

/**
 * Bring the viewports to the current landmark. Returns 'shown', 'none' when no view can show it (no
 * stack holds it, or the MPR view shows another frame), or 'held' for a set that is not placed.
 */
function showLandmark(current, { viewportsState, commandsManager, store = DicomMetadataStore, displaySets = activeDisplaySets() }) {
  if (!current) {
    return 'none';
  }
  const { entry, landmark } = current;
  const { set, document } = entry;
  const placement = landmarks().placementOf(set, store, displaySets);
  if (!placement.placed) {
    return 'held';
  }
  const activeViewportIndex = (viewportsState && viewportsState.activeViewportIndex) || 0;
  const mpr = isMprActive(viewportsState);

  if (set.domain === 'image') {
    const { instance, series } = placement;
    if (mpr) {
      // Only into a view of the image's own frame: its patient position means nothing in another
      const worldPoint = instance && instance.FrameOfReferenceUID
        && instance.FrameOfReferenceUID === mprFrameOfReference(viewportsState, store)
        ? patientPointOfImagePoint(instance, landmark.point) : undefined;
      if (!worldPoint) {
        return 'none';
      }
      const jump = commandsManager.runCommand('jumpToMprWorldPoint', { worldPoint });
      return jump && jump.panes ? 'shown' : 'none';
    }
    commandsManager.runCommand('jumpToImage', {
      StudyInstanceUID: (series[0] && series[0].StudyInstanceUID) || document.StudyInstanceUID,
      SOPInstanceUID: set.image.sopInstanceUID,
      // The frame of a multi-frame instance, resolved to its stack index by the command
      frameNumber: Number(set.image.frameNumber) || 1,
      activeViewportIndex,
    });
    return 'shown';
  }

  if (mpr) {
    // The MPR view shows a series of the set's frame, or the landmark is not there
    if (mprFrameOfReference(viewportsState, store) !== set.frameOfReferenceUID) {
      return 'none';
    }
    const jump = commandsManager.runCommand('jumpToMprWorldPoint', { worldPoint: landmark.point });
    return jump && jump.panes ? 'shown' : 'none';
  }

  // The set's own series first, then the other loaded series of its frame
  const { seriesInstanceUID } = landmarks().attributionOf(set, document, store);
  const series = [...placement.series].sort((a, b) => (a.SeriesInstanceUID === seriesInstanceUID ? -1 : 0)
    - (b.SeriesInstanceUID === seriesInstanceUID ? -1 : 0));
  const outcome = commandsManager.runCommand('jumpToLandmark', {
    worldPoint: landmark.point,
    series: series.map(({ StudyInstanceUID, SeriesInstanceUID }) => ({ StudyInstanceUID, SeriesInstanceUID })),
    activeViewportIndex,
  });
  return outcome === 'shown' ? 'shown' : 'none';
}

/** Whether a panel row's set is placed now */
function isPlaced(entry, store, displaySets) {
  return Boolean(entry) && landmarks().placementOf(entry.set, store, displaySets).placed;
}

/**
 * Selecting a set's row: step to its next landmark and show it. A held set does not step.
 *
 * @param {object} measurementData - the panel row (landmarkSetRows.js)
 * @param {object} context - { viewportsState, commandsManager, store?, displaySets? }
 */
function stepLandmarkRow(measurementData, context) {
  const { key } = measurementData.landmarkSet;
  const store = context.store || DicomMetadataStore;
  const displaySets = 'displaySets' in context ? context.displaySets : activeDisplaySets();
  const entry = landmarks().getLandmarkSet(key);
  if (!isPlaced(entry, store, displaySets)) {
    return 'held';
  }
  return showLandmark(landmarks().stepLandmarkSet(key), { ...context, store, displaySets });
}

/** Choosing a named landmark from a set's card: make it the current one and show it */
function chooseLandmark(measurementData, index, context) {
  const { key } = measurementData.landmarkSet;
  const store = context.store || DicomMetadataStore;
  const displaySets = 'displaySets' in context ? context.displaySets : activeDisplaySets();
  const entry = landmarks().getLandmarkSet(key);
  if (!isPlaced(entry, store, displaySets)) {
    return 'held';
  }
  return showLandmark(landmarks().selectLandmark(key, index), { ...context, store, displaySets });
}


export { chooseLandmark, patientPointOfImagePoint, showLandmark, stepLandmarkRow };
