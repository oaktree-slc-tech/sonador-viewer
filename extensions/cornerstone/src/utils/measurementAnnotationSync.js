// Cornerstone3D representation of the classic Length, Angle, Cobb angle and arrow annotation
// measurements, for the Cornerstone3D views (the 3D Inspector; the volume viewer draws the
// angles). The classic (cornerstone-tools) measurement is the single measurement-service record,
// the one a save writes.
//
// * A classic measurement on an image with a complete plane (position, orientation, pixel spacing)
//   and a full set of handles has a Cornerstone3D annotation with the same geometry, drawn by the
//   tools of those views (for the angles, the exchange-value tools of tools/exchangeAngleTools.js)
//   and edited there while the measurement is not locked. Added or updated -> annotation created
//   or moved, carrying the record's angle with the points it belongs to, and an arrow's text;
//   removed -> removed.
// * An annotation moved in a Cornerstone3D view updates its classic measurement with the value of
//   the new geometry (and redraws the classic viewports), an arrow's text edited there updates the
//   measurement's text; removed there, its measurement is removed.
// * A measurement drawn in a Cornerstone3D view on an acquired image (the view aligned with it,
//   every point within placement distance of its plane) becomes a classic measurement, and its
//   annotation is replaced by the mirror of that measurement: it is saved like one drawn in 2D.
//   Drawn off the plane of the image it references, it has no image the SR writer can reference.
//   It stays in this session's Cornerstone3D views, marked unsaved (drawn dashed by the tools that
//   draw lines), and the user is told it is not saved and why. So does one for which no referenced
//   image was found (an unaligned view, or images without position metadata), one whose image has
//   no usable plane information, a measurement of a tool without a DICOM-SR mapping here (the
//   Inspector's bidirectional, ellipse, rectangle, freehand and probe tools), and one that could
//   not be added to the measurements.
// * The annotation of a locked or read-only measurement (one read from a report, or saved) is
//   locked: it is drawn, and edits made to it are not carried to the measurement.
// * A drawing is taken up after the event that completes it, so a drawing cancelled with Escape
//   (the stock tools complete it, then the view removes it) is neither saved nor announced.
// * The unsaved annotations follow the global annotation visibility (show all / hide all), as the
//   measurements do: they are registered with the measurement API as a visibility source.
//
// Patient points map to image points as DICOM defines them (DICOMSR angleGeometry), as hydration
// and the writer do.

import _ from 'lodash';
import cornerstone from 'cornerstone-core';

import { eventTarget as c3dEventTarget, getRenderingEngines, metaData as c3dMetaData } from '@cornerstonejs/core';
import {
  annotation as c3dAnnotation,
  Enums as c3dToolsEnums,
  utilities as c3dToolsUtilities,
} from '@cornerstonejs/tools';

import OHIF from '@ohif/core';

import { HANDLE_NAMES as ANGLE_HANDLE_NAMES } from './measurementServiceMappings/Cornerstone/Angle';

const { log } = OHIF;

// Classic handles of each synchronised tool, in point order
// (the arrow tip is the first point in both tool sets)
const HANDLE_NAMES = { Length: ['start', 'end'], ArrowAnnotate: ['start', 'end'], ...ANGLE_HANDLE_NAMES };
const ARROW = 'ArrowAnnotate';
const ANGLE_TOOLS = Object.keys(ANGLE_HANDLE_NAMES);

const PREFIX = 'sonador-measurement:';
// Image points closer than this (pixels) are the same point
const POINT_TOLERANCE = 1e-3;
// Distance (mm) a point may lie from an image plane and still belong to the image
const PLANE_TOLERANCE = 1;
// How a measurement that stays in a Cornerstone3D view is drawn
const UNSAVED_STYLE = { lineDash: '4,4' };

// Cornerstone3D tools of those views whose measurements are not saved (no classic mapping)
const UNSAVED_TOOLS = ['Bidirectional', 'EllipticalROI', 'RectangleROI', 'PlanarFreehandROI', 'Probe'];

// Why a measurement drawn in a Cornerstone3D view was not saved
const NOT_SAVED = { PLANE: 'plane', REFERENCE: 'reference', GEOMETRY: 'geometry', UNSUPPORTED: 'unsupported', ERROR: 'error' };

const TOOL_NAMES = {
  CobbAngle: 'Cobb angle',
  ArrowAnnotate: 'arrow annotation',
  Bidirectional: 'bidirectional measurement',
  EllipticalROI: 'ellipse',
  RectangleROI: 'rectangle',
  PlanarFreehandROI: 'freehand outline',
  Probe: 'probe',
};

const KEPT = "It stays in this session's 3D views and is not saved.";

/** The message telling the user why a measurement drawn in a Cornerstone3D view is not saved */
function notSavedMessage(toolName, reason) {
  const name = TOOL_NAMES[toolName] || toolName;
  if (reason === NOT_SAVED.PLANE) {
    return `This ${name} is drawn on a plane that is not an acquired image. ${KEPT} `
      + 'To save it, draw it with the view aligned to the acquisition, or in the 2D viewport.';
  }
  if (reason === NOT_SAVED.REFERENCE) {
    return `No acquired image could be identified for this ${name}: the view may not be aligned with one, `
      + `or the images may lack position information. ${KEPT} To save it, draw it in the 2D viewport.`;
  }
  if (reason === NOT_SAVED.GEOMETRY) {
    return `The image this ${name} is drawn on has no usable position, orientation or pixel spacing, `
      + `so the ${name} cannot be saved. ${KEPT}`;
  }
  if (reason === NOT_SAVED.UNSUPPORTED) {
    return `This ${name} cannot be saved as a measurement from the 3D views. ${KEPT}`;
  }
  return `This ${name} could not be added to the measurements. ${KEPT} `
    + 'To save it, draw it in the 2D viewport.';
}

const annotationUIDFor = measurementUID => `${PREFIX}${measurementUID}`;
const measurementUIDOf = annotationUID =>
  (_.isString(annotationUID) && annotationUID.startsWith(PREFIX) ? annotationUID.slice(PREFIX.length) : null);

const geometry = () => OHIF.DICOMSR.angleGeometry;
const isSynchronised = toolName => !!HANDLE_NAMES[toolName];

// A measurement read from a report, or saved, is locked: its annotation cannot be moved
const isLockedMeasurement = measurement => {
  const metadata = measurement.metadata || {};
  const data = measurement.data || {};
  return Boolean(measurement.isLocked || measurement.isReadOnly || metadata.isLocked || metadata.isReadOnly
    || data.isLocked || data.isReadOnly);
};

function setVisible(annotation, visible) {
  // The annotation's own flag (read by the slice filter of volume viewports) and the visibility
  // state the tools' renderers read
  annotation.isVisible = visible;
  if (c3dAnnotation.visibility.isAnnotationVisible(annotation.annotationUID) !== visible) {
    c3dAnnotation.visibility.setAnnotationVisibility(annotation.annotationUID, visible);
  }
}

function setLocked(annotationUID, locked) {
  if (c3dAnnotation.locking.isAnnotationLocked(annotationUID) !== locked) {
    c3dAnnotation.locking.setAnnotationLocked(annotationUID, locked);
  }
}

const samePoints = (a, b, tolerance = POINT_TOLERANCE) => !!a && !!b && a.length === b.length
  && a.every((point, i) => point.length === b[i].length && point.every((value, j) => Math.abs(value - b[i][j]) <= tolerance));

const sub = (a, b) => a.map((value, i) => value - b[i]);
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const normalOf = module => {
  const [r, c] = [Array.from(module.rowCosines, Number), Array.from(module.columnCosines, Number)];
  return [r[1] * c[2] - r[2] * c[1], r[2] * c[0] - r[0] * c[2], r[0] * c[1] - r[1] * c[0]];
};
const distanceFromPlane = (module, point) =>
  dot(sub(point, Array.from(module.imagePositionPatient, Number)), normalOf(module));


function planeOf(imageId) {
  let module;
  try {
    module = imageId ? c3dMetaData.get('imagePlaneModule', imageId) : undefined;
  } catch (error) {
    module = undefined;
  }
  return geometry().isPlane(module) ? module : null;
}

function imagePointsOf(measurement) {
  // Image points of a classic measurement, in handle order
  const names = HANDLE_NAMES[measurement.toolName];
  const handles = measurement.data && measurement.data.handles;
  if (handles && names.every(name => handles[name])) {
    return names.map(name => [handles[name].x, handles[name].y]);
  }
  const points = measurement.points || [];
  return points.length === names.length ? points.map(point => (_.isArray(point) ? point.slice(0, 2) : [point.x, point.y])) : null;
}

// The text of a classic arrow annotation (the Cornerstone3D tool keeps it as the label)
const textOf = measurement => (measurement.metadata && measurement.metadata.text) || measurement.label
  || (measurement.data && measurement.data.text) || '';

function valueOf(toolName, patientPoints) {
  // The value of patient points: the exchange angle (degrees) or the length (mm); an arrow has none
  if (toolName === ARROW) {
    return undefined;
  }
  if (toolName === 'Length') {
    const [a, b] = patientPoints;
    return Math.sqrt(dot(sub(b, a), sub(b, a)));
  }
  const { encodedAngle, encodedPoints } = geometry();
  return encodedAngle(encodedPoints(toolName, patientPoints));
}

// The session-only annotations: drawn in a Cornerstone3D view and not saved (no measurement)
const unsavedAnnotations = () => (c3dAnnotation.state.getAllAnnotations() || [])
  .filter(annotation => annotation.data && annotation.data.unsaved && !measurementUIDOf(annotation.annotationUID));

const isAnnotationShown = annotation =>
  annotation.isVisible !== false && c3dAnnotation.visibility.isAnnotationVisible(annotation.annotationUID) !== false;

function render() {
  try {
    const viewportIds = _.flatMap(getRenderingEngines() || [], engine => engine.getViewports().map(viewport => viewport.id));
    if (viewportIds.length) {
      c3dToolsUtilities.triggerAnnotationRenderForViewportIds(viewportIds);
    }
  } catch (error) {
    log.debug('[cornerstone:measurementAnnotationSync] unable to render the Cornerstone3D viewports', error);
  }
}

function renderClassic() {
  try {
    (cornerstone.getEnabledElements() || []).filter(enabled => enabled.image)
      .forEach(enabled => cornerstone.updateImage(enabled.element));
  } catch (error) {
    log.debug('[cornerstone:measurementAnnotationSync] unable to redraw the classic viewports', error);
  }
}


/**
 * Keep a Cornerstone3D annotation for each eligible classic Length / Angle / Cobb angle / arrow
 * annotation measurement of `classicSource`, and save the measurements drawn in Cornerstone3D views
 * on acquired images (see the module header). Returns a function that stops the synchronisation.
 *
 * @param {object} measurementService
 * @param {object} classicSource - the classic measurement source (the record a save writes)
 * @param {object} [options]
 * @param {Function} [options.notify] - shows a message to the user ({ title, message, type })
 */
function connectMeasurementAnnotationSync(measurementService, classicSource, options = {}) {
  const { MEASUREMENT_ADDED, MEASUREMENT_UPDATED, MEASUREMENT_REMOVED, MEASUREMENTS_CLEARED } = measurementService.EVENTS;
  const { ANNOTATION_COMPLETED, ANNOTATION_MODIFIED, ANNOTATION_REMOVED } = c3dToolsEnums.Events;
  const notify = options.notify || (() => {});

  // Annotations being removed here, whose removal events must not remove their measurement
  const removing = new Set();

  const isClassic = source => !!source && source.name === classicSource.name && source.version === classicSource.version;

  function removeAnnotation(annotationUID) {
    if (!c3dAnnotation.state.getAnnotation(annotationUID)) {
      return false;
    }
    removing.add(annotationUID);
    try {
      setLocked(annotationUID, false);
      c3dAnnotation.visibility.setAnnotationVisibility(annotationUID, true);
      c3dAnnotation.state.removeAnnotation(annotationUID);
    } finally {
      removing.delete(annotationUID);
    }
    return true;
  }

  function upsertAnnotation(measurement) {
    const imageId = measurement.referencedImageId || (measurement.metadata && measurement.metadata.referencedImageId);
    const module = planeOf(imageId);
    const imagePoints = imagePointsOf(measurement);
    const annotationUID = annotationUIDFor(measurement.uid);
    if (!module || !imagePoints) {
      if (removeAnnotation(annotationUID)) {
        render();
      }
      return null;
    }
    const points = imagePoints.map(point => geometry().imageToPatient(module, point));
    const existing = c3dAnnotation.state.getAnnotation(annotationUID);

    // The record's angle belongs to these points (the exchange tools show it while they match); a
    // copy, since a tool moves the handles in place
    const rAngle = measurement.data && Number(measurement.data.rAngle);
    const recordValue = ANGLE_TOOLS.includes(measurement.toolName) && _.isFinite(rAngle)
      ? { value: rAngle, points: _.cloneDeep(points) } : undefined;

    const label = measurement.toolName === ARROW ? textOf(measurement) : measurement.label;
    const locked = isLockedMeasurement(measurement);
    const visible = measurement.isVisible !== false;
    if (existing) {
      setLocked(annotationUID, locked);
      if (existing.isVisible !== visible) {
        setVisible(existing, visible);
        render();
      }
      // The same points (within tolerance) keep their handle array, which a tool may be dragging
      const moved = !samePoints(existing.data.handles.points, points) || existing.metadata.referencedImageId !== imageId;
      const current = moved ? points : existing.data.handles.points;
      const value = recordValue && { value: recordValue.value, points: _.cloneDeep(current) };
      if (!moved && _.isEqual(existing.data.recordValue, value) && existing.data.label === label) {
        return existing;
      }
      existing.data.handles.points = current;
      existing.data.recordValue = value;
      existing.data.label = label;
      existing.metadata.referencedImageId = imageId;
      existing.invalidated = true;
      render();
      return existing;
    }

    const annotation = {
      annotationUID,
      isLocked: locked,
      isVisible: visible,
      invalidated: true,
      highlighted: false,
      metadata: {
        toolName: measurement.toolName,
        FrameOfReferenceUID: module.frameOfReferenceUID || measurement.FrameOfReferenceUID,
        referencedImageId: imageId,
        viewPlaneNormal: normalOf(module),
      },
      data: {
        label,
        handles: { points, activeHandleIndex: null, textBox: { hasMoved: false } },
        cachedStats: {},
        recordValue,
      },
    };
    c3dAnnotation.state.addAnnotation(annotation, undefined);
    setLocked(annotationUID, locked);
    setVisible(annotation, visible);
    render();
    return annotation;
  }

  function saveDrawnAnnotation(annotation) {
    // A measurement drawn in a Cornerstone3D view on an acquired image becomes a classic
    // measurement; null when it did, otherwise why not (NOT_SAVED)
    const { toolName, referencedImageId } = annotation.metadata;
    // Only a measured distance from a usable image plane shows the drawing is off the acquisition.
    // No referenced image may mean an unaligned view or images without position metadata (the
    // reference lookup skips those); a referenced image without a usable plane cannot place the
    // points.
    if (!referencedImageId) {
      return NOT_SAVED.REFERENCE;
    }
    const module = planeOf(referencedImageId);
    if (!module) {
      return NOT_SAVED.GEOMETRY;
    }
    const points = annotation.data.handles.points;
    if (points.some(point => Math.abs(distanceFromPlane(module, point)) > PLANE_TOLERANCE)) {
      return NOT_SAVED.PLANE;
    }
    const api = OHIF.measurements.MeasurementApi.Instance;
    const { source, toolServiceManaged, toolMapping } = (api && api._serviceManagedTool(toolName)) || {};
    if (!toolServiceManaged || !isClassic(source)) {
      return NOT_SAVED.UNSUPPORTED;
    }

    let instance = {};
    try {
      instance = cornerstone.metaData.get('instance', referencedImageId) || {};
    } catch (error) {
      instance = {};
    }
    const imagePoints = points.map(point => geometry().patientToImage(module, point));
    const handles = _.zipObject(HANDLE_NAMES[toolName], imagePoints.map(([x, y]) => ({ x, y, highlight: true, active: false })));
    const value = valueOf(toolName, points);
    const text = toolName === ARROW ? (annotation.data.label || '') : undefined;
    const _id = OHIF.utils.guid();
    const metadata = {
      _id,
      toolName,
      referencedImageId,
      SOPInstanceUID: instance.SOPInstanceUID,
      SeriesInstanceUID: instance.SeriesInstanceUID,
      StudyInstanceUID: instance.StudyInstanceUID,
      PatientID: instance.PatientID,
      FrameOfReferenceUID: module.frameOfReferenceUID,
      ...(toolName === ARROW ? { text } : {}),
    };
    const valueData = toolName === ARROW ? { text } : toolName === 'Length' ? { length: value } : { rAngle: value };
    const measurement = {
      toolName,
      points: imagePoints.map(([x, y]) => ({ x, y })),
      referencedImageId,
      SOPInstanceUID: instance.SOPInstanceUID,
      FrameOfReferenceUID: module.frameOfReferenceUID,
      referenceSeriesUID: instance.SeriesInstanceUID,
      referenceStudyUID: instance.StudyInstanceUID,
      ...(toolName === 'Length' ? { length: value } : {}),
      ...(toolName === ARROW ? { label: text } : {}),
      data: { _id, handles, ...valueData },
      metadata,
    };

    const classicAnnotation = toolMapping.toAnnotationSchema(measurement, toolName);
    const measurementUID = source.annotationToMeasurement(toolName, classicAnnotation);
    const added = measurementUID && measurementService.getMeasurement(measurementUID);
    if (!added) {
      return NOT_SAVED.ERROR;
    }

    // The classic representation (MeasurementApi) and this annotation's mirror follow the event;
    // the drawn annotation gives way to the mirror
    measurementService._broadcastEvent(MEASUREMENT_ADDED, { source, measurement: added, data: classicAnnotation });
    removeAnnotation(annotation.annotationUID);
    render();
    renderClassic();
    return null;
  }

  function markUnsaved(annotation, reason) {
    try {
      c3dAnnotation.config.style.setAnnotationStyles(annotation.annotationUID, UNSAVED_STYLE);
    } catch (error) {
      log.debug('[cornerstone:measurementAnnotationSync] unable to style an unsaved annotation', error);
    }
    annotation.data.unsaved = true;
    render();
    notify({
      title: 'Measurement not saved',
      message: notSavedMessage(annotation.metadata.toolName, reason),
      type: 'warning',
    });
  }

  function onMeasurementChanged({ source, measurement }) {
    if (measurement && isSynchronised(measurement.toolName) && isClassic(source || measurement.source)) {
      upsertAnnotation(measurement);
    }
  }

  function onMeasurementRemoved({ measurement: measurementUID }) {
    if (removeAnnotation(annotationUIDFor(measurementUID))) {
      render();
    }
  }

  function onMeasurementsCleared() {
    const orphans = (c3dAnnotation.state.getAllAnnotations() || [])
      .filter(annotation => {
        const uid = measurementUIDOf(annotation.annotationUID);
        return uid && !measurementService.getMeasurement(uid);
      })
      .map(annotation => annotation.annotationUID);
    orphans.forEach(removeAnnotation);
    if (orphans.length) {
      render();
    }
  }

  let connected = true;

  function onAnnotationCompleted(event) {
    // A measurement drawn in a Cornerstone3D view, taken up once the code that completed it has
    // finished: a cancelled drawing has been removed by then
    const annotation = event.detail && event.detail.annotation;
    if (!annotation || measurementUIDOf(annotation.annotationUID)) {
      return;
    }
    Promise.resolve().then(() => {
      if (connected && c3dAnnotation.state.getAnnotation(annotation.annotationUID) === annotation) {
        takeUpDrawnAnnotation(annotation);
      }
    });
  }

  function takeUpDrawnAnnotation(annotation) {
    const toolName = annotation.metadata && annotation.metadata.toolName;
    if (UNSAVED_TOOLS.includes(toolName)) {
      markUnsaved(annotation, NOT_SAVED.UNSUPPORTED);
      return;
    }
    if (!isSynchronised(toolName) || annotation.data?.handles?.points?.length !== HANDLE_NAMES[toolName].length) {
      return;
    }
    let reason;
    try {
      reason = saveDrawnAnnotation(annotation);
    } catch (error) {
      log.warn('[cornerstone:measurementAnnotationSync] unable to save a measurement drawn in a Cornerstone3D view', error);
      reason = NOT_SAVED.ERROR;
    }
    if (reason) {
      markUnsaved(annotation, reason);
    }
  }

  function onAnnotationModified(event) {
    const annotation = event.detail && event.detail.annotation;
    const measurementUID = measurementUIDOf(annotation && annotation.annotationUID);
    const measurement = measurementUID && measurementService.getMeasurement(measurementUID);
    if (!measurement || isLockedMeasurement(measurement)) {
      return;
    }
    const module = planeOf(annotation.metadata.referencedImageId);
    if (!module) {
      return;
    }

    const imagePoints = annotation.data.handles.points.map(point => geometry().patientToImage(module, point));
    const isArrow = measurement.toolName === ARROW;
    const text = isArrow ? (annotation.data.label || '') : undefined;
    if (samePoints(imagePointsOf(measurement), imagePoints) && (!isArrow || text === textOf(measurement))) {
      return;
    }

    const names = HANDLE_NAMES[measurement.toolName];
    const handles = { ...(measurement.data && measurement.data.handles) };
    names.forEach((name, i) => {
      handles[name] = { ...(handles[name] || {}), x: imagePoints[i][0], y: imagePoints[i][1] };
    });

    // The value of the new geometry, not the tool's stats cache, which is recalculated (throttled)
    // after the handles move and may still hold the previous value
    const value = valueOf(measurement.toolName, annotation.data.handles.points);
    const finite = _.isFinite(value) ? value : undefined;
    const isLength = measurement.toolName === 'Length';

    const valueData = isArrow ? { text } : isLength ? { length: finite } : { rAngle: finite };

    measurementService.update(measurementUID, {
      ...measurement,
      points: imagePoints.map(([x, y]) => ({ x, y })),
      ...(isLength ? { length: finite } : {}),
      ...(isArrow ? { label: text, metadata: { ...measurement.metadata, text } } : {}),
      data: { ...measurement.data, handles, ...valueData },
    }, true);
    renderClassic();
  }

  function onAnnotationRemoved(event) {
    const annotation = event.detail && event.detail.annotation;
    const annotationUID = annotation && annotation.annotationUID;
    const measurementUID = measurementUIDOf(annotationUID);
    if (measurementUID && !removing.has(annotationUID) && measurementService.getMeasurement(measurementUID)) {
      measurementService.remove(measurementUID);
      renderClassic();
    }
  }

  const subscriptions = [
    measurementService.subscribe(MEASUREMENT_ADDED, onMeasurementChanged),
    measurementService.subscribe(MEASUREMENT_UPDATED, onMeasurementChanged),
    measurementService.subscribe(MEASUREMENT_REMOVED, onMeasurementRemoved),
    measurementService.subscribe(MEASUREMENTS_CLEARED, onMeasurementsCleared),
  ];
  c3dEventTarget.addEventListener(ANNOTATION_COMPLETED, onAnnotationCompleted);
  c3dEventTarget.addEventListener(ANNOTATION_MODIFIED, onAnnotationModified);
  c3dEventTarget.addEventListener(ANNOTATION_REMOVED, onAnnotationRemoved);

  const MeasurementApi = OHIF.measurements && OHIF.measurements.MeasurementApi;
  const removeVisibilitySource = MeasurementApi && typeof MeasurementApi.addAnnotationVisibilitySource === 'function'
    ? MeasurementApi.addAnnotationVisibilitySource({
      visibilities: () => unsavedAnnotations().map(isAnnotationShown),
      setVisibility: (visible) => {
        const annotations = unsavedAnnotations();
        annotations.forEach(annotation => setVisible(annotation, visible));
        if (annotations.length) {
          render();
        }
      },
    })
    : () => {};

  return () => {
    connected = false;
    removeVisibilitySource();
    subscriptions.forEach(subscription => subscription && subscription.unsubscribe && subscription.unsubscribe());
    c3dEventTarget.removeEventListener(ANNOTATION_COMPLETED, onAnnotationCompleted);
    c3dEventTarget.removeEventListener(ANNOTATION_MODIFIED, onAnnotationModified);
    c3dEventTarget.removeEventListener(ANNOTATION_REMOVED, onAnnotationRemoved);
  };
}


export default connectMeasurementAnnotationSync;
export {
  annotationUIDFor, connectMeasurementAnnotationSync, HANDLE_NAMES, measurementUIDOf, NOT_SAVED, notSavedMessage, UNSAVED_TOOLS,
};
