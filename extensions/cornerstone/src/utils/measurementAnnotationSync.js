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
// * A measurement on an image stays on it. A handle dragged off the image's plane in a
//   Cornerstone3D view is moved onto the plane as it is dragged, and a handle dragged outside the
//   image's rows and columns returns, when the drag ends, to where it was before the drag. Points
//   are never clipped to the image's edges.
// * In the 3D Inspector (a registered drawing volume, DICOMSR utils/outOfPlane.js) a Length, Angle
//   or Cobb angle that is not in-plane (off the acquired image's plane, on no acquired image, or
//   with a point outside the image's rows and columns) becomes a pending out-of-plane measurement:
//   a Cornerstone3D-source record holding its patient points, its source series, Drawing-Plane and
//   View, listed and saved with the others. The first in a session is announced as shown in the
//   MPR and 3D views only. It is edited on its drawing plane until it is saved, and locked after.
//   On a volume loaded at reduced resolution, or a series without a Frame of Reference, the drawing
//   stays in the session, dashed, with the reason.
// * The annotation of a locked or read-only measurement (one read from a report, or saved, or one
//   the user locked) is locked: it is drawn, and edits made to it are not carried to the
//   measurement. The annotation is drawn in the measurement's stored line and text colors, locked
//   or not; highlighted or selected, it keeps the tools' colors.
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
import { getLineTextColor } from '@ohif/core/src/displayAttributes';

import {
  CIRCLE_TOOL_NAMES, circlePlanePoints, circleRadius, circleValues, classicToolName, cornerstone3DToolName, isCircleTool,
  isLegacyGeometry,
} from '@ohif/core/src/DICOMSR/utils/circleGeometry';

import { HANDLE_NAMES as ANGLE_HANDLE_NAMES } from './measurementServiceMappings/Cornerstone/Angle';

const { log } = OHIF;

// Classic handles of each synchronised tool, in point order (the arrow tip is the first point in
// both tool sets; a circle's center then its edge point). The circle is `CircleRoi` in the classic
// tools and `CircleROI` in Cornerstone3D (and in its out-of-plane records).
const HANDLE_NAMES = {
  Length: ['start', 'end'],
  ArrowAnnotate: ['start', 'end'],
  ...ANGLE_HANDLE_NAMES,
  [CIRCLE_TOOL_NAMES.CLASSIC]: ['start', 'end'],
  [CIRCLE_TOOL_NAMES.CORNERSTONE_3D]: ['start', 'end'],
};
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

// Why a measurement drawn in a Cornerstone3D view was not saved (OUTSIDE: on the plane, a point
// outside the image's rows and columns)
const NOT_SAVED = {
  PLANE: 'plane', REFERENCE: 'reference', GEOMETRY: 'geometry', OUTSIDE: 'outside', UNSUPPORTED: 'unsupported', ERROR: 'error',
  REDUCED_RESOLUTION: 'reduced-resolution', FRAME_OF_REFERENCE: 'frame-of-reference',
};
// The reasons a drawing in the Inspector becomes an out-of-plane measurement instead
const OUT_OF_PLANE_REASONS = [NOT_SAVED.PLANE, NOT_SAVED.REFERENCE, NOT_SAVED.GEOMETRY, NOT_SAVED.OUTSIDE];

const TOOL_NAMES = {
  CobbAngle: 'Cobb angle',
  CircleROI: 'circle',
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
  if (reason === NOT_SAVED.REDUCED_RESOLUTION) {
    return `This series is shown at reduced resolution, so the ${name} cannot be saved from this view. ${KEPT}`;
  }
  if (reason === NOT_SAVED.FRAME_OF_REFERENCE) {
    return `This series has no Frame of Reference, so a ${name} drawn off its acquired images cannot be saved. ${KEPT}`;
  }
  return `This ${name} could not be added to the measurements. ${KEPT} `
    + 'To save it, draw it in the 2D viewport.';
}

const annotationUIDFor = measurementUID => `${PREFIX}${measurementUID}`;
const measurementUIDOf = annotationUID =>
  (_.isString(annotationUID) && annotationUID.startsWith(PREFIX) ? annotationUID.slice(PREFIX.length) : null);

const geometry = () => OHIF.DICOMSR.angleGeometry;
const outOfPlane = () => OHIF.DICOMSR.outOfPlane;
const drawingPlanes = () => OHIF.DICOMSR.drawingPlane;
const measurementViews = () => OHIF.DICOMSR.measurementView;

// The message shown the first time in a session a drawing becomes an out-of-plane measurement
const OUT_OF_PLANE_NOTICE = {
  title: '3D measurement',
  message: 'This measurement is pending: it is saved with the other measurements when you save them. '
    + 'It is shown in the MPR and 3D views only.',
  type: 'info',
};
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

// The style last given to each annotation for its measurement's colors
const lineTextStyles = new Map();

function setLineTextStyle(annotation, measurement, { created = false } = {}) {
  // The measurement's stored line and text colors as its annotation's style; true when it changed.
  // A created annotation is given its style whatever was given before under its uid; one without
  // colors is left with the tools' style.
  const carrier = measurement.displayAttributes || (measurement.data && measurement.data.displayAttributes)
    || (measurement.metadata && measurement.metadata.displayAttributes);
  const { line, text } = getLineTextColor({ displayAttributes: carrier }, measurement.toolName);
  const style = {
    ...(annotation.data && annotation.data.unsaved ? UNSAVED_STYLE : {}),
    ...(line ? { color: line, colorLocked: line } : {}),
    ...(text ? { textBoxColor: text, textBoxColorLocked: text } : {}),
  };
  const { annotationUID } = annotation;
  const unchanged = created
    ? _.isEmpty(style) && !lineTextStyles.has(annotationUID)
    : _.isEqual(lineTextStyles.get(annotationUID) || {}, style);
  if (unchanged) {
    return false;
  }
  lineTextStyles.set(annotationUID, style);
  c3dAnnotation.config.style.setAnnotationStyles(annotationUID, style);
  return true;
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

/** The point moved along the image's normal onto its plane */
function ontoPlane(module, point) {
  const normal = normalOf(module);
  const distance = distanceFromPlane(module, point) / dot(normal, normal);
  return point.map((value, i) => value - distance * normal[i]);
}

/** Whether every image point lies within the image's columns and rows; true when they are unknown */
function insideImage(module, imagePoints) {
  const [columns, rows] = [Number(module.columns), Number(module.rows)];
  if (!(columns > 0) || !(rows > 0)) {
    return true;
  }
  return imagePoints.every(([x, y]) => x >= 0 && x <= columns && y >= 0 && y <= rows);
}


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
  // The value of patient points: the exchange angle (degrees), the length (mm), or a circle's values
  // ({ radius, area, perimeter }); an arrow has none
  if (toolName === ARROW) {
    return undefined;
  }
  if (isCircleTool(toolName)) {
    return circleValues(circleRadius(patientPoints[0], patientPoints[1]));
  }
  if (toolName === 'Length') {
    const [a, b] = patientPoints;
    return Math.sqrt(dot(sub(b, a), sub(b, a)));
  }
  const { encodedAngle, encodedPoints } = geometry();
  return encodedAngle(encodedPoints(toolName, patientPoints));
}

/**
 * A measurement's value with the points it belongs to: an angle's (degrees) or a Length's (mm) as
 * { value, points }, a circle's as { values: { radius, area, perimeter }, points }
 */
function recordValueOf(measurement, points) {
  const data = measurement.data || {};
  if (isCircleTool(measurement.toolName)) {
    const stats = data.cachedStats;
    return stats && _.isFinite(stats.radius)
      ? { values: _.pick(stats, ['radius', 'area', 'perimeter']), points: _.cloneDeep(points) } : undefined;
  }
  const value = ANGLE_TOOLS.includes(measurement.toolName) ? Number(data.rAngle)
    : measurement.toolName === 'Length' ? Number(_.isNil(measurement.length) ? data.length : measurement.length) : NaN;
  return _.isFinite(value) ? { value, points: _.cloneDeep(points) } : undefined;
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
 * @param {object} [options.outOfPlaneSource] - the Cornerstone3D source of out-of-plane measurements
 */
function connectMeasurementAnnotationSync(measurementService, classicSource, options = {}) {
  const {
    MEASUREMENT_ADDED, MEASUREMENT_UPDATED, MEASUREMENT_REMOVED, MEASUREMENTS_CLEARED, RAW_MEASUREMENT_ADDED,
  } = measurementService.EVENTS;
  // The source of out-of-plane measurements
  const outOfPlaneSource = options.outOfPlaneSource;
  // Whether this session has announced an out-of-plane measurement
  let announced = false;
  const { ANNOTATION_COMPLETED, ANNOTATION_MODIFIED, ANNOTATION_REMOVED } = c3dToolsEnums.Events;
  const notify = options.notify || (() => {});

  // Annotations being removed here, whose removal events must not remove their measurement
  const removing = new Set();
  // Annotations of measurements being dragged: their patient points before the drag
  const dragging = new Map();

  const isClassic = source => !!source && source.name === classicSource.name && source.version === classicSource.version;

  function removeAnnotation(annotationUID) {
    if (!c3dAnnotation.state.getAnnotation(annotationUID)) {
      return false;
    }
    removing.add(annotationUID);
    lineTextStyles.delete(annotationUID);
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

    // The record's value belongs to these points (the exchange tools and the 3D display show it
    // while they match); a copy, since a tool moves the handles in place
    const recordValue = recordValueOf(measurement, points);

    const label = measurement.toolName === ARROW ? textOf(measurement) : measurement.label;
    const locked = isLockedMeasurement(measurement);
    const visible = measurement.isVisible !== false;
    if (existing) {
      setLocked(annotationUID, locked);
      if (existing.isVisible !== visible) {
        setVisible(existing, visible);
        render();
      }
      if (setLineTextStyle(existing, measurement)) {
        render();
      }
      // The same points (within tolerance) keep their handle array, which a tool may be dragging
      const moved = !samePoints(existing.data.handles.points, points) || existing.metadata.referencedImageId !== imageId;
      const current = moved ? points : existing.data.handles.points;
      const value = recordValue && { ...recordValue, points: _.cloneDeep(current) };
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
        toolName: cornerstone3DToolName(measurement.toolName),
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
    setLineTextStyle(annotation, measurement, { created: true });
    render();
    return annotation;
  }

  function saveDrawnAnnotation(annotation, { insideImageOnly = false } = {}) {
    // A measurement drawn in a Cornerstone3D view on an acquired image becomes a classic
    // measurement; null when it did, otherwise why not (NOT_SAVED). With `insideImageOnly`, a
    // point outside the image's rows and columns keeps it off the image.
    const { referencedImageId } = annotation.metadata;
    const toolName = classicToolName(annotation.metadata.toolName);
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
    if (insideImageOnly && !insideImage(module, imagePoints)) {
      return NOT_SAVED.OUTSIDE;
    }
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
    const valueData = toolName === ARROW ? { text } : toolName === 'Length' ? { length: value }
      : isCircleTool(toolName) ? { cachedStats: value } : { rAngle: value };
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
    // An annotation belongs to a measurement by its uid: without one there is nothing to follow
    if (!measurement || !measurement.uid) {
      return;
    }
    if (outOfPlane().isOutOfPlaneMeasurement(measurement)) {
      upsertOutOfPlaneAnnotation(measurement);
    } else if (measurement && isSynchronised(measurement.toolName) && isClassic(source || measurement.source)) {
      upsertAnnotation(measurement);
    }
  }

  function onMeasurementRemoved({ measurement: measurementUID }) {
    if (removeAnnotation(annotationUIDFor(measurementUID))) {
      render();
    }
  }

  function onMeasurementsCleared() {
    announced = false;
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
    // The Inspector's volume, for the tools an out-of-plane measurement can be made with
    const volume = outOfPlane().OUT_OF_PLANE_TOOLS.includes(toolName)
      ? outOfPlane().drawingVolumeOf(annotation.metadata.volumeId) : undefined;
    if (volume && volume.reducedResolution) {
      markUnsaved(annotation, NOT_SAVED.REDUCED_RESOLUTION);
      return;
    }
    let reason;
    try {
      reason = saveDrawnAnnotation(annotation, { insideImageOnly: !!volume });
      if (volume && OUT_OF_PLANE_REASONS.includes(reason)) {
        reason = adoptOutOfPlane(annotation, volume);
      }
    } catch (error) {
      log.warn('[cornerstone:measurementAnnotationSync] unable to save a measurement drawn in a Cornerstone3D view', error);
      reason = NOT_SAVED.ERROR;
    }
    if (reason) {
      markUnsaved(annotation, reason);
    }
  }

  function adoptOutOfPlane(annotation, volume) {
    // The drawing becomes a pending out-of-plane measurement; null when it did, otherwise why not
    const { toolName, viewPlaneNormal, viewUp } = annotation.metadata;
    const FrameOfReferenceUID = annotation.metadata.FrameOfReferenceUID || volume.FrameOfReferenceUID;
    if (!FrameOfReferenceUID) {
      return NOT_SAVED.FRAME_OF_REFERENCE;
    }
    if (!outOfPlaneSource) {
      return NOT_SAVED.UNSUPPORTED;
    }
    const points = annotation.data.handles.points.map(point => Array.from(point, Number));
    const plane = drawingPlanes().drawingPlaneOfView(viewPlaneNormal, viewUp);
    const view = measurementViews().viewOfNormal(viewPlaneNormal);
    const uid = OHIF.utils.guid();
    const record = outOfPlaneRecord(toolName, points, {
      FrameOfReferenceUID,
      referenceStudyUID: volume.StudyInstanceUID,
      referenceSeriesUID: volume.SeriesInstanceUID,
      label: annotation.data.label || '',
      metadata: {
        outOfPlane: true,
        toolName,
        FrameOfReferenceUID,
        sourceSeries: volume.SeriesInstanceUID,
        drawingPlane: plane ? drawingPlanes().formatDrawingPlane(plane) : undefined,
        views: view ? [view] : [],
        isReadOnly: false,
      },
    });

    // The record's mirror (added on RAW_MEASUREMENT_ADDED) replaces the drawing once the record is
    // accepted; until then, and when it is not, the drawing stays
    const added = measurementService.addRawMeasurement(outOfPlaneSource, toolName, { id: uid, annotation: { data: {} } }, () => record);
    if (!added) {
      return NOT_SAVED.ERROR;
    }
    removeAnnotation(annotation.annotationUID);
    if (!announced) {
      announced = true;
      notify(OUT_OF_PLANE_NOTICE);
    }
    return null;
  }

  function outOfPlaneRecord(toolName, points, attributes) {
    // The measurement-service record of an out-of-plane measurement with these points
    if (isCircleTool(toolName)) {
      const values = valueOf(toolName, points);
      return {
        toolName, points, isLocked: false, isDirty: true, unit: 'mm', data: { cachedStats: values }, ...attributes,
      };
    }
    const value = valueOf(toolName, points);
    const finite = _.isFinite(value) ? value : undefined;
    const isLength = toolName === 'Length';
    return {
      toolName,
      points,
      isLocked: false,
      isDirty: true,
      ...(isLength ? { length: finite, unit: 'mm' } : { value: finite, unit: 'deg' }),
      data: isLength ? { length: finite } : { rAngle: finite },
      ...attributes,
    };
  }

  function upsertOutOfPlaneAnnotation(measurement) {
    // The Cornerstone3D annotation of an out-of-plane measurement: its patient points, drawn in a
    // view whose plane contains them. A Cobb angle whose lines lie in no common plane is kept under
    // a tool name no slice tool draws, for the 3D display only. A circle read from an ELLIPSE keeps
    // that ELLIPSE's plane; one read from a stock CIRCLE SCOORD3D has no known plane: it is drawn
    // in a view holding its two points and marked `planeUnknown`.
    const annotationUID = annotationUIDFor(measurement.uid);
    const points = (measurement.points || []).map(point => Array.from(point, Number));
    const metadata = measurement.metadata || {};
    const isCircle = isCircleTool(measurement.toolName);
    const planeUnknown = isCircle && isLegacyGeometry(metadata.sourceGeometry);
    const planePoints = isCircle ? circlePlanePoints(points, metadata.sourceGeometry) || points : points;
    const plane = points.length === HANDLE_NAMES[measurement.toolName].length
      ? drawingPlanes().navigationPlaneOf(planePoints, metadata.drawingPlane) : undefined;
    if (!plane || (isCircle && plane.kind === 'none')) {
      if (removeAnnotation(annotationUID)) {
        render();
      }
      return null;
    }
    const toolName = plane.kind === 'none' ? outOfPlane().NON_PLANAR_COBB_ANGLE : measurement.toolName;
    const present = c3dAnnotation.state.getAnnotation(annotationUID);
    if (present && present.metadata.toolName !== toolName) {
      removeAnnotation(annotationUID);
    }
    const label = measurement.label;
    const locked = isLockedMeasurement(measurement);
    const visible = measurement.isVisible !== false;
    const recordValue = recordValueOf(measurement, points);

    const existing = c3dAnnotation.state.getAnnotation(annotationUID);
    if (existing) {
      setLocked(annotationUID, locked);
      if (existing.isVisible !== visible) {
        setVisible(existing, visible);
      }
      setLineTextStyle(existing, measurement);
      if (!samePoints(existing.data.handles.points, points)) {
        existing.data.handles.points = points;
      }
      existing.data.label = label;
      existing.data.recordValue = recordValue && { ...recordValue, points: _.cloneDeep(existing.data.handles.points) };
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
        toolName,
        FrameOfReferenceUID: measurement.FrameOfReferenceUID || metadata.FrameOfReferenceUID,
        ...(plane.kind === 'none' ? {} : { viewPlaneNormal: plane.normal, viewUp: plane.height.map(value => -value) }),
        ...(planeUnknown ? { planeUnknown: true } : {}),
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
    setLineTextStyle(annotation, measurement, { created: true });
    render();
    return annotation;
  }

  function updateOutOfPlaneMeasurement(measurementUID, measurement, annotation) {
    // A pending out-of-plane measurement edited in a Cornerstone3D view: its handles stay on its
    // drawing plane (through its first point), and its value follows
    const metadata = measurement.metadata || {};
    const [origin] = measurement.points || [];
    const plane = origin && drawingPlanes().navigationPlaneOf(measurement.points, metadata.drawingPlane);
    const handlePoints = annotation.data.handles.points;
    if (plane && plane.kind !== 'none') {
      const { normal } = plane;
      handlePoints.forEach((point, i) => {
        const distance = dot(sub(point, origin), normal);
        if (Math.abs(distance) > POINT_TOLERANCE) {
          handlePoints[i] = point.map((value, axis) => value - distance * normal[axis]);
        }
      });
    }
    const points = handlePoints.map(point => Array.from(point, Number));
    if (samePoints(measurement.points, points)) {
      return;
    }
    const updated = outOfPlaneRecord(measurement.toolName, points, {});
    measurementService.update(measurementUID, {
      ...measurement,
      points,
      ..._.pick(updated, 'length', 'value'),
      data: { ...measurement.data, ...updated.data },
    }, true);
  }

  function onAnnotationModified(event) {
    const annotation = event.detail && event.detail.annotation;
    const measurementUID = measurementUIDOf(annotation && annotation.annotationUID);
    const measurement = measurementUID && measurementService.getMeasurement(measurementUID);
    if (!measurement || isLockedMeasurement(measurement)) {
      return;
    }
    if (outOfPlane().isOutOfPlaneMeasurement(measurement)) {
      updateOutOfPlaneMeasurement(measurementUID, measurement, annotation);
      return;
    }
    const module = planeOf(annotation.metadata.referencedImageId);
    if (!module) {
      return;
    }

    // The handles stay on the image's plane, moved in place: a tool may hold the array it drags
    const points = annotation.data.handles.points;
    points.forEach((point, i) => {
      if (Math.abs(distanceFromPlane(module, point)) > POINT_TOLERANCE) {
        points[i] = ontoPlane(module, point);
      }
    });

    if (!dragging.has(annotation.annotationUID)) {
      const before = imagePointsOf(measurement);
      dragging.set(annotation.annotationUID, before && before.map(point => geometry().imageToPatient(module, point)));
    }
    const imagePoints = points.map(point => geometry().patientToImage(module, point));
    // Outside the image, the measurement keeps its points until the drag ends
    if (!insideImage(module, imagePoints)) {
      return;
    }
    updateMeasurement(measurementUID, measurement, annotation, imagePoints);
  }

  function updateMeasurement(measurementUID, measurement, annotation, imagePoints) {
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

    const valueData = isArrow ? { text } : isLength ? { length: finite }
      : isCircleTool(measurement.toolName) ? { cachedStats: value } : { rAngle: finite };

    measurementService.update(measurementUID, {
      ...measurement,
      points: imagePoints.map(([x, y]) => ({ x, y })),
      ...(isLength ? { length: finite } : {}),
      ...(isArrow ? { label: text, metadata: { ...measurement.metadata, text } } : {}),
      data: { ...measurement.data, handles, ...valueData },
    }, true);
    renderClassic();
  }

  function onDragEnded() {
    // A drag ended (the tools end theirs on the document, before this listener on the window): a
    // handle left outside the image returns to where it was before the drag
    const drags = [...dragging.entries()];
    dragging.clear();
    drags.forEach(([annotationUID, before]) => {
      const annotation = c3dAnnotation.state.getAnnotation(annotationUID);
      const module = annotation && planeOf(annotation.metadata.referencedImageId);
      if (!module || !before) {
        return;
      }
      const points = annotation.data.handles.points;
      if (insideImage(module, points.map(point => geometry().patientToImage(module, point)))) {
        return;
      }
      before.forEach((point, i) => {
        points[i] = point;
      });
      annotation.invalidated = true;
      // The measurement followed the drag while it was inside the image
      const measurementUID = measurementUIDOf(annotationUID);
      const measurement = measurementService.getMeasurement(measurementUID);
      if (measurement && !isLockedMeasurement(measurement)) {
        updateMeasurement(measurementUID, measurement, annotation, before.map(point => geometry().patientToImage(module, point)));
      }
      render();
    });
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
    ...(RAW_MEASUREMENT_ADDED ? [measurementService.subscribe(RAW_MEASUREMENT_ADDED, onMeasurementChanged)] : []),
    measurementService.subscribe(MEASUREMENT_REMOVED, onMeasurementRemoved),
    measurementService.subscribe(MEASUREMENTS_CLEARED, onMeasurementsCleared),
  ];
  c3dEventTarget.addEventListener(ANNOTATION_COMPLETED, onAnnotationCompleted);
  c3dEventTarget.addEventListener(ANNOTATION_MODIFIED, onAnnotationModified);
  c3dEventTarget.addEventListener(ANNOTATION_REMOVED, onAnnotationRemoved);
  const dragEndEvents = typeof window !== 'undefined' ? ['mouseup', 'touchend'] : [];
  dragEndEvents.forEach(name => window.addEventListener(name, onDragEnded));

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
    dragEndEvents.forEach(name => window.removeEventListener(name, onDragEnded));
  };
}


export default connectMeasurementAnnotationSync;
export {
  annotationUIDFor, connectMeasurementAnnotationSync, HANDLE_NAMES, measurementUIDOf, NOT_SAVED, notSavedMessage,
  OUT_OF_PLANE_NOTICE, UNSAVED_TOOLS,
};
