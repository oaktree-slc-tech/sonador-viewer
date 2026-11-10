// Read-only DICOM-SR measurements as Cornerstone3D annotations, drawn by the DICOMSRDisplay tool
// (extensions/vtk) in the Cornerstone3D viewports. Adapted from the OHIF v3 cornerstone-dicom-sr
// `addSRAnnotation` and `dicomSRModule`.
//
// Geometry is held in patient coordinates with the measurement's Frame of Reference, so the
// annotation manager only offers an annotation to viewports in that Frame of Reference. The
// annotations are not measurement-service measurements: they are display only, and a hydrated
// (editable) measurement is never also added here. Placement and image references live under
// `data`, not `metadata`, so the library's own annotation filters leave them alone; the tool
// decides visibility with `isViewable`.

import { getRenderingEngines } from '@cornerstonejs/core';
import { annotation as c3dAnnotation, utilities as c3dToolsUtilities } from '@cornerstonejs/tools';

import log from '../../log';
import TOOL_NAMES from '../constants/toolNames';
import { getRenderableData, inPlaneVectors } from './renderableData';

export const TOOL_NAME = TOOL_NAMES.DICOM_SR_DISPLAY_C3D;

// Unit-vector dot product below which two directions count as perpendicular
const ORTHOGONAL_EPSILON = 1e-3;

const state = {
  activeTrackingUniqueIdentifier: null,
};


const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = a => {
  const magnitude = Math.sqrt(dot(a, a));
  return magnitude ? [a[0] / magnitude, a[1] / magnitude, a[2] / magnitude] : a;
};


export const annotationUIDFor = TrackingUniqueIdentifier => `${TOOL_NAME}:${TrackingUniqueIdentifier}`;


export function renderSRDisplayAnnotations() {
  // Redraw the annotations of every Cornerstone3D viewport. A no-op before Cornerstone3D renders.
  let viewportIds = [];
  try {
    (getRenderingEngines() || []).forEach(engine => {
      viewportIds = viewportIds.concat(engine.getViewports().map(viewport => viewport.id));
    });
    if (viewportIds.length) {
      c3dToolsUtilities.triggerAnnotationRenderForViewportIds(viewportIds);
    }
  } catch (error) {
    log.debug('[DICOM-SR:srDisplayAnnotations] unable to trigger annotation render', error);
  }
}


/**
 * Add (or replace) the read-only Cornerstone3D annotation of an SR measurement.
 *
 * @param {object} options
 * @param {object} options.measurement - parsed SR measurement: coords, labels, tracking identifiers
 * @param {object} [options.plane] - plane of the image the measurement is drawn on (imagePlane.js);
 *   required for SCOORD content, absent for SCOORD3D content placed by Frame of Reference only
 * @param {string} [options.imageId] - id of that image
 * @param {string} [options.FrameOfReferenceUID] - overrides the Frame of Reference otherwise taken
 *   from the content (SCOORD3D) or the image plane
 * @param {string} [options.displaySetInstanceUID] - image display set the measurement is linked to
 * @param {boolean} [options.render] - redraw the Cornerstone3D viewports (default true)
 * @returns {object|null} the annotation, or null when nothing can be drawn
 */
export function addSRDisplayAnnotation({
  measurement, plane, imageId, FrameOfReferenceUID, displaySetInstanceUID, render = true,
}) {
  const { TrackingUniqueIdentifier, TrackingIdentifier, labels = [], frameNumber } = measurement || {};
  if (!TrackingUniqueIdentifier) {
    return null;
  }

  const coords = (measurement.coords || []).filter(coord => coord && coord.GraphicType);
  const renderableData = coords.map(coord => getRenderableData(coord, plane)).filter(Boolean);
  if (!renderableData.length) {
    return null;
  }

  const coord3d = coords.find(coord => coord.ValueType === 'SCOORD3D');
  const frameOfReferenceUID = FrameOfReferenceUID
    || (coord3d && coord3d.ReferencedFrameOfReferenceSequence)
    || (plane && plane.frameOfReferenceUID);
  if (!frameOfReferenceUID) {
    log.warn('[DICOM-SR:srDisplayAnnotations] no Frame of Reference for TrackingUniqueIdentifier='
      + TrackingUniqueIdentifier + ', not displayed in Cornerstone3D viewports');
    return null;
  }

  const points = [].concat(...renderableData.map(item => item.points));

  // Image coordinates belong to their image plane: they are shown in views parallel to it. Patient
  // coordinates are shown in any view whose plane contains them.
  const isImageContent = coords.some(coord => coord.ValueType !== 'SCOORD3D');
  const srPlane = {
    point: points[0],
    inPlaneVectors: inPlaneVectors(points),
    sourceNormal: isImageContent && plane ? plane.normal : undefined,
  };

  const annotationUID = annotationUIDFor(TrackingUniqueIdentifier);
  if (c3dAnnotation.state.getAnnotation(annotationUID)) {
    c3dAnnotation.state.removeAnnotation(annotationUID);
  }

  const annotation = {
    annotationUID,
    isLocked: true,
    isVisible: true,
    invalidated: false,
    highlighted: false,
    metadata: {
      toolName: TOOL_NAME,
      FrameOfReferenceUID: frameOfReferenceUID,
    },
    data: {
      TrackingUniqueIdentifier,
      TrackingIdentifier,
      labels,
      renderableData,
      srPlane,
      referencedImageId: imageId,
      displaySetInstanceUID,
      frameNumber,
      handles: {
        points,
        textBox: { hasMoved: false, worldPosition: undefined, worldBoundingBox: undefined },
      },
      cachedStats: {},
    },
  };

  try {
    c3dAnnotation.state.addAnnotation(annotation, undefined);
  } catch (error) {
    // The annotation is stored before Cornerstone3D announces it to the viewports of its Frame of
    // Reference; the announcement fails for a tool group still listing a viewport that is no
    // longer enabled (a view closed while the report reloads). The annotation is kept and drawn
    // by the next render.
    if (!c3dAnnotation.state.getAnnotation(annotation.annotationUID)) {
      log.warn('[DICOM-SR:srDisplayAnnotations] annotation not added', TrackingUniqueIdentifier, error);
      return undefined;
    }
    log.warn('[DICOM-SR:srDisplayAnnotations] annotation added; its Frame of Reference viewports were not told', error);
  }

  if (render) {
    renderSRDisplayAnnotations();
  }

  return annotation;
}


/** Remove the read-only annotation of a measurement */
export function removeSRDisplayAnnotation(TrackingUniqueIdentifier, { render = true } = {}) {
  const annotationUID = annotationUIDFor(TrackingUniqueIdentifier);
  if (!c3dAnnotation.state.getAnnotation(annotationUID)) {
    return false;
  }

  c3dAnnotation.state.removeAnnotation(annotationUID);
  if (render) {
    renderSRDisplayAnnotations();
  }
  return true;
}


/** Every read-only SR annotation */
export function getSRDisplayAnnotations() {
  return (c3dAnnotation.state.getAllAnnotations() || [])
    .filter(annotation => annotation?.metadata?.toolName === TOOL_NAME);
}


/** Remove every read-only SR annotation (a cleared measurement session) */
export function clearSRDisplayAnnotations({ render = true } = {}) {
  const annotations = getSRDisplayAnnotations();
  annotations.forEach(annotation => c3dAnnotation.state.removeAnnotation(annotation.annotationUID));
  state.activeTrackingUniqueIdentifier = null;

  if (render && annotations.length) {
    renderSRDisplayAnnotations();
  }
  return annotations.length;
}


/** Show or hide the read-only annotation of a measurement */
export function setSRDisplayAnnotationVisible(TrackingUniqueIdentifier, visible) {
  const annotation = c3dAnnotation.state.getAnnotation(annotationUIDFor(TrackingUniqueIdentifier));
  if (!annotation) {
    return false;
  }

  annotation.isVisible = !!visible;
  renderSRDisplayAnnotations();
  return true;
}


/** Draw the measurement with this tracking UID in the active colour; null clears it */
export function setActiveTrackingUniqueIdentifier(TrackingUniqueIdentifier) {
  state.activeTrackingUniqueIdentifier = TrackingUniqueIdentifier || null;
  renderSRDisplayAnnotations();
}


export function getActiveTrackingUniqueIdentifier() {
  return state.activeTrackingUniqueIdentifier;
}


/**
 * Whether an annotation belongs in a view. Every annotation of the view's Frame of Reference is
 * shown in a 3D view. In a slice view the annotation must lie in the displayed slice: within half
 * the slice spacing of the focal plane, with image content shown only in views parallel to its
 * image, and patient content in any view whose plane contains it.
 *
 * @param {object} annotation - read-only SR annotation
 * @param {object} view
 * @param {boolean} [view.is3D]
 * @param {number[]} [view.viewPlaneNormal]
 * @param {number[]} [view.focalPoint]
 * @param {number} [view.halfSpacing] - half the slice spacing along the normal (mm)
 */
export function isViewable(annotation, { is3D, viewPlaneNormal, focalPoint, halfSpacing }) {
  if (!annotation || annotation.isVisible === false) {
    return false;
  }
  if (is3D) {
    return true;
  }

  const { srPlane } = annotation.data || {};
  if (!srPlane || !srPlane.point || !viewPlaneNormal || !focalPoint) {
    return false;
  }

  const normal = unit(viewPlaneNormal);

  if (srPlane.sourceNormal) {
    if (Math.abs(dot(unit(srPlane.sourceNormal), normal)) < 1 - ORTHOGONAL_EPSILON) {
      return false;
    }
  } else if ((srPlane.inPlaneVectors || []).some(vector => Math.abs(dot(vector, normal)) > ORTHOGONAL_EPSILON)) {
    return false;
  }

  const offset = [
    srPlane.point[0] - focalPoint[0],
    srPlane.point[1] - focalPoint[1],
    srPlane.point[2] - focalPoint[2],
  ];
  const tolerance = Math.max(Number(halfSpacing) || 0, ORTHOGONAL_EPSILON);
  return Math.abs(dot(offset, normal)) <= tolerance;
}


export default {
  TOOL_NAME,
  annotationUIDFor,
  renderSRDisplayAnnotations,
  addSRDisplayAnnotation,
  removeSRDisplayAnnotation,
  getSRDisplayAnnotations,
  clearSRDisplayAnnotations,
  setSRDisplayAnnotationVisible,
  setActiveTrackingUniqueIdentifier,
  getActiveTrackingUniqueIdentifier,
  isViewable,
};
