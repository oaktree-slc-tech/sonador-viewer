// Cornerstone3D Angle and Cobb angle tools that show the DICOM-SR exchange value, as the classic
// tools and the SR writer do (DICOMSR angleGeometry): the Cornerstone3D formula on the points in
// handle order. The stock Cobb angle tool reorders the endpoints by proximity first, which gives the
// supplement for some drawings. An annotation that mirrors a classic measurement carries that
// measurement's value (`data.recordValue`, with the points it belongs to); while its points are
// unchanged that value is shown, so an imported stored value reads the same in every view.
//
// The stock renderers skip the label of an angle that is exactly 0 (they test the value for
// truthiness); the tools draw that label after the stock render.
//
// The Length tool likewise shows a mirrored record's stored length while the points are unchanged,
// in millimetres; a new or edited Length shows the stock calibrated length.
//
// They keep the stock tool names and are registered before any view registers the stock tools,
// so every tool group that adds `Length`, `Angle` or `CobbAngle` gets them.

import _ from 'lodash';

import { addTool, annotation as c3dAnnotation, AngleTool, CobbAngleTool, LengthTool } from '@cornerstonejs/tools';

import OHIF from '@ohif/core';

/** The exchange value of an annotation (DICOMSR angleGeometry `annotationAngle`) */
const exchangeValue = (toolName, annotation) => OHIF.DICOMSR.angleGeometry.annotationAngle(toolName, annotation.data);


function applyExchangeValue(toolName, annotation) {
  const value = exchangeValue(toolName, annotation);
  const { cachedStats } = annotation.data || {};
  Object.keys(cachedStats || {}).forEach(targetId => {
    cachedStats[targetId] = { ...cachedStats[targetId], angle: _.isFinite(value) ? value : null };
  });
}


function renderZeroLabels(tool, enabledElement, svgDrawingHelper, label) {
  // The linked label of each displayed annotation whose angle is 0, as the stock renderer draws a
  // non-zero one; absent and invalid values stay unlabelled
  const { viewport } = enabledElement;
  const { element } = viewport;
  const annotations = tool.filterInteractableAnnotationsForElement(
    element, c3dAnnotation.state.getAnnotations(tool.getToolName(), element) || []) || [];
  const targetId = tool.getTargetId(viewport);

  annotations.forEach(annotation => {
    const { annotationUID, data } = annotation;
    const stats = data && data.cachedStats && data.cachedStats[targetId];
    if (!stats || stats.angle !== 0 || !c3dAnnotation.visibility.isAnnotationVisible(annotationUID)) {
      return;
    }
    const canvasCoordinates = data.handles.points.map(point => viewport.worldToCanvas(point));
    tool.renderLinkedTextBoxAnnotation({
      enabledElement,
      svgDrawingHelper,
      annotation,
      styleSpecifier: { toolGroupId: tool.toolGroupId, toolName: tool.getToolName(), viewportId: viewport.id, annotationUID },
      textLines: tool.configuration.getTextLines(data, targetId) || [],
      canvasCoordinates,
      ...label(canvasCoordinates),
    });
  });
}

function withZeroLabels(tool, label) {
  // The stock renderer is an instance property
  const stockRender = tool.renderAnnotation;
  tool.renderAnnotation = (enabledElement, svgDrawingHelper) => {
    const status = stockRender(enabledElement, svgDrawingHelper);
    renderZeroLabels(tool, enabledElement, svgDrawingHelper, label);
    return status;
  };
}


class ExchangeAngleTool extends AngleTool {
  constructor(...args) {
    super(...args);
    // Anchored at the vertex, as the stock label
    withZeroLabels(this, canvasCoordinates => ({ placementPoints: [canvasCoordinates[1], canvasCoordinates[1]] }));
  }

  _calculateCachedStats(annotation, ...args) {
    const stats = super._calculateCachedStats(annotation, ...args);
    if (annotation.data && annotation.data.handles && annotation.data.handles.points.length === 3) {
      applyExchangeValue('Angle', annotation);
    }
    return stats;
  }
}


// Not near either line: what the pointer tests of a Cobb angle without its four points get
const NOT_NEAR_LINES = Object.freeze({
  distanceToPoint: Infinity, distanceToPoint2: Infinity, isNearFirstLine: false, isNearSecondLine: false,
});

class ExchangeCobbAngleTool extends CobbAngleTool {
  constructor(...args) {
    super(...args);
    withZeroLabels(this, () => ({ textBoxUID: 'cobbAngleText' }));

    // The stock pointer tests (hover, selection) measure the distance to both lines and fail on a
    // Cobb angle without its four points, such as one still being drawn (its first line only)
    const distanceToLines = this.distanceToLines;
    this.distanceToLines = (options) => {
      const points = (options && options.points) || [];
      return points.length >= 4 && points.slice(0, 4).every(Boolean) ? distanceToLines(options) : NOT_NEAR_LINES;
    };
  }

  _calculateCachedStats(annotation, ...args) {
    const stats = super._calculateCachedStats(annotation, ...args);
    if (annotation.data && annotation.data.handles && annotation.data.handles.points.length === 4) {
      applyExchangeValue('CobbAngle', annotation);
    }
    return stats;
  }
}


class ExchangeLengthTool extends LengthTool {
  _calculateCachedStats(annotation, ...args) {
    const stats = super._calculateCachedStats(annotation, ...args);
    const recorded = OHIF.DICOMSR.angleGeometry.unchangedRecordValue(annotation.data);
    if (recorded === undefined) {
      return stats;
    }
    const { cachedStats } = annotation.data;
    Object.keys(cachedStats || {}).forEach(targetId => {
      const targetStats = cachedStats[targetId];
      // Only a length the stock tool measured in millimetres is the record's
      if (!targetStats || targetStats.unit !== 'mm') {
        return;
      }
      cachedStats[targetId] = {
        ...targetStats,
        length: recorded,
        statsArray: (targetStats.statsArray || []).map(stat => (stat.name === 'length' ? { ...stat, value: recorded } : stat)),
      };
    });
    return cachedStats;
  }
}


/** Register the exchange tools under the stock names (a later stock registration is ignored) */
function registerExchangeAngleTools() {
  addTool(ExchangeAngleTool);
  addTool(ExchangeCobbAngleTool);
  addTool(ExchangeLengthTool);
}


export default registerExchangeAngleTools;
export { exchangeValue, ExchangeAngleTool, ExchangeCobbAngleTool, ExchangeLengthTool, registerExchangeAngleTools };
