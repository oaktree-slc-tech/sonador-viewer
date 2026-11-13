// cornerstone-tools Bidirectional whose lengths follow the DICOM-SR exchange profile (DICOMSR
// bidirectionalGeometry.js): `start`, `end` are the long axis and `perpendicularStart`,
// `perpendicularEnd` the short axis, each measured as labelled, in millimetres between its patient
// points, so the drawn label, the Measurements panel and the saved report agree on any pixel spacing.
// The stock tool keeps its drawing behaviour: the short axis follows the long one while it is
// created, stays perpendicular to it, and the longer pair becomes the long axis.
//
// The tool data keeps the lengths as `longestDiameter` and `shortestDiameter`, numbers. A measurement
// whose lengths are held (`recordValue`, { values: { length, width, unit, widthUnit }, points } in
// image coordinates, as hydrated or mirrored) keeps each axis' value and unit while that axis has the
// points it belongs to; a moved handle recomputes its own axis. The label has two lines, `L: … mm` and
// `W: … mm`, each axis in its unit, as in the Cornerstone3D views.
//
// The stock tool sets its callbacks on the instance; they are moved to the prototype chain here, so
// a subclass (tools/lockableMeasurementTool.js) can override them.

import csTools from 'cornerstone-tools';
import OHIF from '@ohif/core';

import imagePlaneOf from './imagePlaneOf';

const draw = csTools.importInternal('drawing/draw');
const drawHandles = csTools.importInternal('drawing/drawHandles');
const drawLine = csTools.importInternal('drawing/drawLine');
const drawLinkedTextBox = csTools.importInternal('drawing/drawLinkedTextBox');
const getNewContext = csTools.importInternal('drawing/getNewContext');
const setShadow = csTools.importInternal('drawing/setShadow');
const getPixelSpacing = csTools.importInternal('util/getPixelSpacing');

// Image points closer than this (pixels) are the same point
const POINT_TOLERANCE = 1e-3;
const STOCK_CALLBACKS = ['renderToolData', 'pointNearTool', 'handleSelectedCallback'];

const geometry = () => OHIF.DICOMSR.bidirectionalGeometry;


/**
 * The lengths of a Bidirectional's handles on an image: { length, width, unit, widthUnit }, each axis in
 * millimetres between its patient points, or scaled by the pixel spacing that is known when the image
 * has no plane (in pixels without one). An axis keeps the held value (`recordValue`) while its image
 * points are those it belongs to.
 */
function bidirectionalValuesOf(image, handles, recordValue) {
  const names = geometry().HANDLE_NAMES;
  const imagePoints = names.map(name => [handles[name].x, handles[name].y]);
  const module = image && imagePlaneOf(image.imageId);
  let measured;
  let unit = 'mm';
  if (module) {
    measured = imagePoints.map(point => OHIF.DICOMSR.angleGeometry.imageToPatient(module, point));
  } else {
    const { rowPixelSpacing, colPixelSpacing } = getPixelSpacing(image);
    unit = rowPixelSpacing && colPixelSpacing ? 'mm' : 'px';
    measured = imagePoints.map(([x, y]) => [x * (colPixelSpacing || 1), y * (rowPixelSpacing || 1)]);
  }
  return geometry().valuesKeepingAxes(imagePoints, recordValue, POINT_TOLERANCE, geometry().bidirectionalValues(measured), unit);
}

/** The two label lines of a Bidirectional's tool data */
function bidirectionalTextLines(data) {
  return geometry().bidirectionalLabelLines({
    length: Number(data.longestDiameter), width: Number(data.shortestDiameter), unit: data.unit, widthUnit: data.widthUnit,
  });
}

/**
 * While a Bidirectional is created, its short axis is placed across the middle of the long axis, half
 * its length (the stock tool's placement, which its render runs for the handle it marks `locked`)
 */
function placePerpendicularHandles(image, data) {
  const { start, end, perpendicularStart, perpendicularEnd } = data.handles;
  if (!perpendicularStart.locked) {
    return;
  }
  const { columnPixelSpacing = 1, rowPixelSpacing = 1 } = image || {};
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const dx = (start.x - end.x) * columnPixelSpacing;
  const dy = (start.y - end.y) * rowPixelSpacing;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) {
    Object.assign(perpendicularStart, { x: start.x, y: start.y });
    Object.assign(perpendicularEnd, { x: end.x, y: end.y });
    return;
  }
  const vector = { x: dx / length, y: dy / length };
  const half = length / 2;
  Object.assign(perpendicularStart, { x: mid.x + (half / (2 * columnPixelSpacing)) * vector.y, y: mid.y - (half / (2 * rowPixelSpacing)) * vector.x });
  Object.assign(perpendicularEnd, { x: mid.x - (half / (2 * columnPixelSpacing)) * vector.y, y: mid.y + (half / (2 * rowPixelSpacing)) * vector.x });
}


export default class BidirectionalTool extends csTools.BidirectionalTool {
  constructor(props) {
    super(props);
    this._stockCallbacks = {};
    STOCK_CALLBACKS.forEach(name => {
      this._stockCallbacks[name] = this[name];
      delete this[name];
    });
  }

  pointNearTool(...args) {
    return this._stockCallbacks.pointNearTool(...args);
  }

  handleSelectedCallback(...args) {
    return this._stockCallbacks.handleSelectedCallback(...args);
  }

  updateCachedStats(image, element, data) {
    if (data.toolName && data.toolName !== this.name) {
      return;
    }
    const { length, width, unit, widthUnit } = bidirectionalValuesOf(image, data.handles, data.recordValue);
    Object.assign(data, { longestDiameter: length, shortestDiameter: width, unit, widthUnit });
    data.invalidated = false;
  }

  renderToolData(evt) {
    const eventData = evt.detail;
    const { element, canvasContext, image } = eventData;
    const toolData = csTools.getToolState(element, this.name);
    if (!toolData) {
      return;
    }
    // As the stock tool: no Bidirectional without pixel spacing
    const { rowPixelSpacing, colPixelSpacing } = getPixelSpacing(image);
    if (!rowPixelSpacing || !colPixelSpacing) {
      return;
    }

    const { handleRadius, drawHandlesOnHover, hideHandlesIfMoving, renderDashed } = this.configuration;
    const lineDash = csTools.getModule('globalConfiguration').configuration.lineDash;
    const lineWidth = csTools.toolStyle.getToolWidth();
    const context = getNewContext(canvasContext.canvas);

    toolData.data.forEach((data) => {
      const names = geometry().HANDLE_NAMES;
      if (data.visible === false || !data.handles || names.some(name => !data.handles[name])) {
        return;
      }
      const color = csTools.toolColors.getColorIfActive(data);
      if (data.invalidated === true || !Number.isFinite(Number(data.longestDiameter))) {
        this.updateCachedStats(image, element, data);
      }

      draw(context, (ctx) => {
        setShadow(ctx, this.configuration);
        const lineOptions = renderDashed ? { color, lineDash } : { color };
        const { start, end, perpendicularStart, perpendicularEnd, textBox } = data.handles;
        drawLine(ctx, element, start, end, lineOptions);
        placePerpendicularHandles(image, data);
        drawLine(ctx, element, perpendicularStart, perpendicularEnd, { ...lineOptions, strokeWidth: lineWidth });
        if (this.configuration.drawHandles !== false) {
          drawHandles(ctx, eventData, data.handles, { color, handleRadius, drawHandlesIfActive: drawHandlesOnHover, hideHandlesIfMoving });
        }
        const labels = Array.isArray(data.labels) ? data.labels : [];
        drawLinkedTextBox(ctx, element, textBox, [...labels, ...bidirectionalTextLines(data)], data.handles,
          handles => [handles.start, handles.end, handles.perpendicularStart, handles.perpendicularEnd], color, lineWidth, 10, true);
      });
    });
  }
}


export { BidirectionalTool, bidirectionalTextLines, bidirectionalValuesOf };
