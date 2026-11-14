// Arrow markers in the classic viewport (utils/arrowMarkers). An arrow labels a point that exists on
// every slice: the arrows of the series the image belongs to whose tip is less than one slice spacing
// from the image, and that this image does not draw (made on a neighbouring slice, or out-of-plane in
// the 3D views), show a ring at their tip, projected onto the image, in their line color. Hovering a
// ring shows the arrow's label; pressing it scrolls the stack to the slice nearest the tip. Hidden
// arrows show nothing; read-only DICOM-SR arrows are included.
//
// Enabled on every image (init.js): it draws, and takes input only through the markers.

import cornerstone from 'cornerstone-core';
import { importInternal, getToolState, toolColors } from 'cornerstone-tools';

import OHIF from '@ohif/core';

import imagePlaneOf from './imagePlaneOf';
import {
  MARKER_RADIUS, clearArrowMarkers, isNearSlice, nearestImageIndex, setArrowMarkers, signedDistanceFromImagePlane,
} from '../utils/arrowMarkers';
import { ensureArrowMarkerTooltip } from '../components/ArrowMarkerTooltip';

const BaseTool = importInternal('base/BaseTool');
const drawCircle = importInternal('drawing/drawCircle');
const getNewContext = importInternal('drawing/getNewContext');
const scrollToIndex = importInternal('util/scrollToIndex');

const TOOL_NAME = 'SonadorArrowMarker';
const ARROW_TOOL = 'ArrowAnnotate';
const SR_ARROW = /:ArrowAnnotate$/;

const seriesOfImage = (imageId) => {
  try {
    const module = cornerstone.metaData.get('generalSeriesModule', imageId);
    return module && module.seriesInstanceUID;
  } catch (error) {
    return undefined;
  }
};

const isPatientPoint = point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
const imagePoint = point => (Array.isArray(point) ? [Number(point[0]), Number(point[1])] : [Number(point.x), Number(point.y)]);

/** The patient tip of an arrow's record: its first point, mapped through its image when it has one */
function recordTip(record) {
  const [tip] = record.points || [];
  if (!tip) {
    return undefined;
  }
  if (isPatientPoint(tip)) {
    return tip;
  }
  const plane = record.referencedImageId && imagePlaneOf(record.referencedImageId);
  if (!plane) {
    return undefined;
  }
  const point = OHIF.DICOMSR.angleGeometry.imageToPatient(plane, imagePoint(tip));
  return point.every(Number.isFinite) ? point : undefined;
}

const recordSeries = record => record.referenceSeriesUID || (record.metadata || {}).sourceSeries
  || (record.metadata || {}).SeriesInstanceUID;

const recordLabel = (record) => {
  const meta = record.metadata || {};
  const text = [meta.text, record.label].find(value => typeof value === 'string' && value !== '') || '';
  return OHIF.DICOMSR.arrowGeometry.arrowDisplayText(text, meta.codedFinding);
};

const recordColor = (record) => {
  const carrier = record.displayAttributes || (record.metadata || {}).displayAttributes || (record.data || {}).displayAttributes;
  return OHIF.displayAttributes.getLineTextColor({ displayAttributes: carrier }, ARROW_TOOL).line;
};

/**
 * The arrows an image does not draw, of the series it belongs to: { key, tip, label, color }.
 *
 * @param {string} imageId - the image shown
 * @param {Set<string>} drawn - measurement uids the image's arrow tool state draws
 */
function arrowsNotDrawn(imageId, drawn) {
  const series = seriesOfImage(imageId);
  if (!series) {
    return [];
  }

  const service = OHIF.measurements.MeasurementApi.Instance && OHIF.measurements.MeasurementApi.Instance.measurementService;
  const records = (service ? service.getMeasurements() : [])
    .filter(record => record.toolName === ARROW_TOOL && record.isVisible !== false && recordSeries(record) === series
      && record.referencedImageId !== imageId && !drawn.has(record.uid))
    .map(record => ({ key: record.uid, tip: recordTip(record), label: recordLabel(record), color: recordColor(record) }));

  // Read-only DICOM-SR arrows, by the image they are placed on
  const readOnly = OHIF.DICOMSR.srDisplayAnnotations.getSRDisplayAnnotations()
    .filter(annotation => annotation.isVisible !== false && SR_ARROW.test(String((annotation.data || {}).TrackingIdentifier || ''))
      && annotation.data.referencedImageId && annotation.data.referencedImageId !== imageId
      && seriesOfImage(annotation.data.referencedImageId) === series)
    .map(({ annotationUID, data }) => ({
      key: annotationUID,
      tip: (data.handles && data.handles.points || [])[0],
      label: ((data.labels || []).find(label => label && label.value) || {}).value || '',
      color: OHIF.displayAttributes.getLineTextColor({ Color: data.displayColor }, ARROW_TOOL).line,
    }));

  return [...records, ...readOnly].filter(arrow => isPatientPoint(arrow.tip));
}

/**
 * Whether a patient point is near an image of a stack: on it, or less than the distance to the
 * neighbouring image on the point's side (both images a point falls between; only the one it lies
 * on). Past the end of the stack, the distance to its other neighbour, else the image's slice
 * thickness, else 1 mm, stands in.
 */
function isNearImage(element, imageId, plane, point) {
  const distance = signedDistanceFromImagePlane(plane, point);
  if (!Number.isFinite(distance)) {
    return false;
  }
  if (Math.abs(distance) < 1e-3) {
    return true;
  }
  const stack = (getToolState(element, 'stack') || {}).data;
  const { imageIds = [] } = (stack && stack[0]) || {};
  const index = imageIds.indexOf(imageId);
  const neighbours = [index - 1, index + 1]
    .filter(neighbour => index >= 0 && neighbour >= 0 && neighbour < imageIds.length)
    .map(neighbour => signedDistanceFromImagePlane(plane, (imagePlaneOf(imageIds[neighbour]) || {}).imagePositionPatient))
    .filter(offset => Number.isFinite(offset) && Math.abs(offset) > 0);
  const towards = neighbours.find(offset => Math.sign(offset) === Math.sign(distance));
  const spacing = towards !== undefined ? Math.abs(towards)
    : (neighbours.length ? Math.abs(neighbours[0]) : Number(plane.sliceThickness) || 1);
  return isNearSlice(Math.abs(distance), spacing);
}

function scrollToNearestSlice(element, tip) {
  const stack = (getToolState(element, 'stack') || {}).data;
  const { imageIds, currentImageIdIndex } = (stack && stack[0]) || {};
  if (!imageIds || !imageIds.length) {
    return;
  }
  const index = nearestImageIndex(imageIds.map(imagePlaneOf), tip);
  if (index >= 0 && index !== currentImageIdIndex) {
    scrollToIndex(element, index);
  }
}


// A disabled element's rings, and its hover, go with it
let listeningForDisabled = false;
function clearOnDisable() {
  if (listeningForDisabled || !cornerstone.events) {
    return;
  }
  listeningForDisabled = true;
  cornerstone.events.addEventListener(cornerstone.EVENTS.ELEMENT_DISABLED, evt => clearArrowMarkers(evt.detail && evt.detail.element));
}


export default class ArrowMarkerTool extends BaseTool {
  constructor(props = {}) {
    super({ name: TOOL_NAME, mixins: [], ...props });
    clearOnDisable();
  }

  renderToolData(evt) {
    const { element, image, canvasContext } = evt.detail;
    const canvas = canvasContext && canvasContext.canvas;
    const plane = image && imagePlaneOf(image.imageId);
    if (!canvas || !plane) {
      setArrowMarkers(element, canvas, []);
      return;
    }

    // The arrows this image draws (its arrow tool state, the visible ones)
    const toolState = getToolState(element, ARROW_TOOL);
    const drawn = new Set(((toolState && toolState.data) || [])
      .filter(data => data.visible !== false).map(data => data.uid || data._measurementServiceId).filter(Boolean));

    // The arrows near this slice, as rings in canvas pixels, recorded in CSS pixels
    const near = arrowsNotDrawn(image.imageId, drawn).filter(arrow => isNearImage(element, image.imageId, plane, arrow.tip));
    const scale = canvas.width / (canvas.clientWidth || canvas.width) || 1;
    const context = getNewContext(canvas);
    const markers = near.map((arrow) => {
      const [x, y] = OHIF.DICOMSR.angleGeometry.patientToImage(plane, arrow.tip);
      const center = cornerstone.pixelToCanvas(element, { x, y });
      drawCircle(context, element, center, MARKER_RADIUS * scale,
        { color: arrow.color || toolColors.getToolColor(), lineWidth: 1.5 * scale }, 'canvas');
      return {
        x: center.x / scale, y: center.y / scale, label: arrow.label,
        activate: () => scrollToNearestSlice(element, arrow.tip),
      };
    });

    if (markers.length) {
      ensureArrowMarkerTooltip();
    }
    setArrowMarkers(element, canvas, markers);
  }
}

export { TOOL_NAME as ARROW_MARKER_TOOL, ArrowMarkerTool, arrowsNotDrawn, isNearImage, recordTip, scrollToNearestSlice };
