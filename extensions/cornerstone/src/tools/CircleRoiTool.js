// cornerstone-tools circle whose values follow the DICOM-SR exchange profile (DICOMSR
// circleGeometry.js): `start` is the center and `end` a point on the circumference; the radius is
// the distance between their patient points, in millimetres, the perimeter 2 pi r and the area
// pi r^2, so the drawn values, the Measurements panel and the saved report agree on any pixel
// spacing. The label shows the radius and the area; no intensity statistics are computed or shown.
// A measurement whose values are held (`cachedStats`, as hydrated) shows them until an edit
// invalidates it.

import csTools from 'cornerstone-tools';
import { metaData as c3dMetaData } from '@cornerstonejs/core';
import OHIF from '@ohif/core';

const draw = csTools.importInternal('drawing/draw');
const drawCircle = csTools.importInternal('drawing/drawCircle');
const drawHandles = csTools.importInternal('drawing/drawHandles');
const drawLinkedTextBox = csTools.importInternal('drawing/drawLinkedTextBox');
const getNewContext = csTools.importInternal('drawing/getNewContext');
const setShadow = csTools.importInternal('drawing/setShadow');
const getROITextBoxCoords = csTools.importInternal('util/getROITextBoxCoords');
const getPixelSpacing = csTools.importInternal('util/getPixelSpacing');


function imagePlaneOf(imageId) {
  // The image plane of the image (Cornerstone3D metadata, else the classic provider)
  for (const provider of [c3dMetaData, csTools.external.cornerstone && csTools.external.cornerstone.metaData]) {
    try {
      const module = provider && provider.get('imagePlaneModule', imageId);
      if (OHIF.DICOMSR.angleGeometry.isPlane(module)) {
        return module;
      }
    } catch (error) {
      // try the next provider
    }
  }
  return undefined;
}

/**
 * The values of a circle's handles on an image: { radius, area, perimeter, unit } in millimetres
 * from their patient points, or in pixels (scaled by the pixel spacing that is known) when the image
 * has no plane.
 */
function circleValuesOf(image, handles) {
  const { angleGeometry, circleGeometry } = OHIF.DICOMSR;
  const { start, end } = handles;
  const module = image && imagePlaneOf(image.imageId);
  if (module) {
    const [center, edge] = [start, end].map(({ x, y }) => angleGeometry.imageToPatient(module, [x, y]));
    return { ...circleGeometry.circleValues(circleGeometry.circleRadius(center, edge)), unit: 'mm' };
  }
  const { rowPixelSpacing, colPixelSpacing } = getPixelSpacing(image);
  const calibrated = !!(rowPixelSpacing && colPixelSpacing);
  const radius = Math.hypot((end.x - start.x) * (colPixelSpacing || 1), (end.y - start.y) * (rowPixelSpacing || 1));
  return { ...circleGeometry.circleValues(radius), unit: calibrated ? 'mm' : 'px' };
}

/** The two label lines of a circle's values */
function circleTextLines(stats) {
  const unit = (stats && stats.unit) || 'mm';
  const format = value => (Number.isFinite(value) ? value.toFixed(2) : '–');
  return [`Radius: ${format(stats && stats.radius)} ${unit}`, `Area: ${format(stats && stats.area)} ${unit}²`];
}

/** The four points of the circle the label's link line can anchor to */
function anchorPoints(start, end) {
  const radius = Math.hypot(end.x - start.x, end.y - start.y);
  return [
    { x: start.x - radius, y: start.y },
    { x: start.x + radius, y: start.y },
    { x: start.x, y: start.y - radius },
    { x: start.x, y: start.y + radius },
  ];
}


export default class CircleRoiTool extends csTools.CircleRoiTool {
  updateCachedStats(image, element, data) {
    data.cachedStats = circleValuesOf(image, data.handles);
    data.invalidated = false;
  }

  renderToolData(evt) {
    const toolData = csTools.getToolState(evt.currentTarget, this.name);
    if (!toolData) {
      return;
    }

    const eventData = evt.detail;
    const { image, element, canvasContext } = eventData;
    const { cornerstone } = csTools.external;
    const lineWidth = csTools.toolStyle.getToolWidth();
    const { handleRadius, drawHandlesOnHover, hideHandlesIfMoving, renderDashed } = this.configuration;
    const lineDash = csTools.getModule('globalConfiguration').configuration.lineDash;
    const context = getNewContext(canvasContext.canvas);

    draw(context, (ctx) => {
      toolData.data.forEach((data) => {
        if (data.visible === false || !data.handles || !data.handles.start || !data.handles.end) {
          return;
        }
        const color = csTools.toolColors.getColorIfActive(data);
        setShadow(ctx, this.configuration);

        const startCanvas = cornerstone.pixelToCanvas(element, data.handles.start);
        const endCanvas = cornerstone.pixelToCanvas(element, data.handles.end);
        const radius = Math.hypot(endCanvas.x - startCanvas.x, endCanvas.y - startCanvas.y);
        drawCircle(ctx, element, data.handles.start, radius, renderDashed ? { color, lineDash } : { color }, 'pixel');

        data.handles.start.drawnIndependently = true;
        data.handles.end.drawnIndependently = true;
        drawHandles(ctx, eventData, data.handles, { color, handleRadius, drawHandlesIfActive: drawHandlesOnHover, hideHandlesIfMoving });

        if (data.invalidated === true || !data.cachedStats || !Number.isFinite(data.cachedStats.radius)) {
          this.updateCachedStats(image, element, data);
        }

        if (!data.handles.textBox.hasMoved) {
          Object.assign(data.handles.textBox, getROITextBoxCoords(eventData.viewport, data.handles));
        }
        drawLinkedTextBox(ctx, element, data.handles.textBox, circleTextLines(data.cachedStats), data.handles,
          handles => anchorPoints(handles.start, handles.end), color, lineWidth, 10, true);
      });
    });
  }
}


export { CircleRoiTool, circleTextLines, circleValuesOf };
