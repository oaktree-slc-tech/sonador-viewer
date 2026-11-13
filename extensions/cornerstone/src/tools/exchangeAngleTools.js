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
// The circle tool shows the exchange values (DICOMSR circleGeometry): the radius between its two
// world points in millimetres, the perimeter 2 pi r and the area pi r^2, or a mirrored record's
// stored values while its points are unchanged. The stock tool's pixel statistics (mean, standard
// deviation, maximum, in the unit of the image) are kept for the detail card; its minimum is dropped.
//
// The Bidirectional tool shows its two lengths as labelled (DICOMSR bidirectionalGeometry): the
// long axis points[0..1], the short axis points[2..3], each in millimetres between its world points
// or a mirrored record's stored value and unit while that axis' points are unchanged (the stock tool reports
// the longer axis as the length whatever the labels). Its label is `L: … mm` and `W: … mm`, as the
// classic tool draws it. The stock tool swaps the axes when a drag ends with the short one longer;
// a swap of an existing annotation is announced as a modification, so its measurement follows.
//
// The circle's and the Cobb angle's labels show the values the measurement chose for the viewport
// (`data.viewportValues`, set from its detail card), else the tool's default (the circle's radius
// and area, the Cobb angle's angle), formatted as the Annotations panel formats them
// (measurements/tools/measurementDetail.js `viewportLabelLines`).
//
// They keep the stock tool names and are registered before any view registers the stock tools,
// so every tool group that adds `Length`, `Angle`, `CobbAngle`, `CircleROI` or `Bidirectional` gets
// them.

import _ from 'lodash';

import {
  addTool, annotation as c3dAnnotation, AngleTool, BidirectionalTool, CircleROITool, CobbAngleTool, Enums as c3dToolsEnums,
  LengthTool, utilities as c3dToolsUtilities,
} from '@cornerstonejs/tools';

import OHIF from '@ohif/core';
import { viewportLabelLines } from '@ohif/core/src/measurements/tools/measurementDetail';

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

/** The Cobb angle's label: the values its measurement shows, from its exchange angle and its points */
function cobbTextLines(data, targetId) {
  const stats = (data && data.cachedStats && data.cachedStats[targetId]) || {};
  if (!Number.isFinite(stats.angle)) {
    return [];
  }
  // The angle alone reads as the stock label does
  if (!Array.isArray(data.viewportValues) || !data.viewportValues.some(key => key !== 'angle')) {
    return [`${c3dToolsUtilities.roundNumber(stats.angle)} \u00B0`];
  }
  return viewportLabelLines('CobbAngle', {
    rAngle: stats.angle, points: (data.handles && data.handles.points) || [], viewportValues: data.viewportValues,
  });
}

class ExchangeCobbAngleTool extends CobbAngleTool {
  constructor(toolProps = {}, ...args) {
    super(toolProps, ...args);
    if (!(toolProps.configuration && toolProps.configuration.getTextLines)) {
      this.configuration.getTextLines = cobbTextLines;
    }
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


// Stock statistics the circle does not show
const DROPPED_STATS = ['min', 'pointsInShape'];

/** Give a circle annotation's statistics, for every view, its exchange values */
function applyCircleValues(annotation) {
  const values = OHIF.DICOMSR.circleGeometry.annotationCircle(annotation.data);
  const { cachedStats } = annotation.data || {};
  Object.keys(cachedStats || {}).forEach(targetId => {
    // The stock pass reports pixels on an image without calibration; that unit is kept
    const unit = OHIF.DICOMSR.circleGeometry.circleUnit(cachedStats[targetId]);
    const areaUnit = `${unit}\u00B2`;
    cachedStats[targetId] = {
      ..._.omit(cachedStats[targetId], DROPPED_STATS),
      ...values,
      radiusUnit: unit,
      areaUnit,
      isEmptyArea: !(values.radius > 0),
      statsArray: [
        { name: 'area', value: values.area, unit: areaUnit, type: 'area' },
        { name: 'radius', value: values.radius, unit, type: 'linear' },
        { name: 'circumference', value: values.perimeter, unit, type: 'linear' },
      ],
    };
  });
}

/** The circle's label: the values its measurement shows (by default its radius and its area) */
function circleTextLines(data, targetId) {
  const stats = (data && data.cachedStats && data.cachedStats[targetId]) || {};
  if (!Number.isFinite(stats.radius)) {
    return [];
  }
  return viewportLabelLines('CircleROI', { cachedStats: stats, viewportValues: data.viewportValues });
}

class ExchangeCircleROITool extends CircleROITool {
  constructor(toolProps = {}, defaultToolProps) {
    super(toolProps, defaultToolProps);
    if (!(toolProps.configuration && toolProps.configuration.getTextLines)) {
      this.configuration.getTextLines = circleTextLines;
    }
    // The stock statistics are instance properties: the stock pass runs (it keeps the handle
    // checks and the modified events), then the exchange values replace its own
    const stockCalculateCachedStats = this._calculateCachedStats;
    this._calculateCachedStats = (annotation, ...args) => {
      const result = stockCalculateCachedStats(annotation, ...args);
      applyCircleValues(annotation);
      return result;
    };
    this._throttledCalculateCachedStats = c3dToolsUtilities.throttle(this._calculateCachedStats, 100, { trailing: true });
  }
}


/** Give a Bidirectional annotation's statistics, for every view, its two lengths as labelled */
function applyBidirectionalValues(annotation) {
  const { annotationBidirectional } = OHIF.DICOMSR.bidirectionalGeometry;
  const values = annotationBidirectional(annotation.data);
  const { cachedStats } = annotation.data || {};
  Object.keys(cachedStats || {}).forEach(targetId => {
    // The stock pass reports pixels on an image without calibration; those statistics are kept
    if (!cachedStats[targetId] || cachedStats[targetId].unit !== 'mm') {
      return;
    }
    cachedStats[targetId] = {
      ...cachedStats[targetId],
      length: values.length,
      width: values.width,
      unit: values.unit,
      widthUnit: values.widthUnit,
      statsArray: [
        { value: values.length, name: 'height', unit: values.unit, type: 'linear' },
        { value: values.width, name: 'width', unit: values.widthUnit, type: 'linear' },
      ],
    };
  });
}

/** The Bidirectional's label: `L: … mm`, `W: … mm` */
function bidirectionalTextLines(data, targetId) {
  const stats = (data && data.cachedStats && data.cachedStats[targetId]) || {};
  return OHIF.DICOMSR.bidirectionalGeometry.bidirectionalLabelLines(stats);
}

const pointsOf = annotation => annotation.data.handles.points.map(point => Array.from(point));

class ExchangeBidirectionalTool extends BidirectionalTool {
  constructor(toolProps = {}, defaultToolProps) {
    super(toolProps, defaultToolProps);
    if (!(toolProps.configuration && toolProps.configuration.getTextLines)) {
      this.configuration.getTextLines = bidirectionalTextLines;
    }
    // The stock statistics and drag end are instance properties: the stock pass runs, then the
    // lengths as labelled replace its own
    const stockCalculateCachedStats = this._calculateCachedStats;
    this._calculateCachedStats = (annotation, ...args) => {
      const result = stockCalculateCachedStats(annotation, ...args);
      applyBidirectionalValues(annotation);
      return result;
    };
    this._throttledCalculateCachedStats = c3dToolsUtilities.throttle(this._calculateCachedStats, 100, { trailing: true });

    const stockEndCallback = this._endCallback;
    this._endCallback = (evt) => {
      const { annotation, newAnnotation } = this.editData || {};
      const before = annotation && pointsOf(annotation);
      const result = stockEndCallback(evt);
      if (annotation && !newAnnotation && c3dAnnotation.state.getAnnotation(annotation.annotationUID) === annotation
          && !_.isEqual(before, pointsOf(annotation))) {
        annotation.invalidated = true;
        c3dAnnotation.state.triggerAnnotationModified(annotation, evt.detail && evt.detail.element,
          c3dToolsEnums.ChangeTypes.HandlesUpdated);
      }
      return result;
    };
  }
}


/** Register the exchange tools under the stock names (a later stock registration is ignored) */
function registerExchangeAngleTools() {
  addTool(ExchangeAngleTool);
  addTool(ExchangeCobbAngleTool);
  addTool(ExchangeLengthTool);
  addTool(ExchangeCircleROITool);
  addTool(ExchangeBidirectionalTool);
}


export default registerExchangeAngleTools;
export {
  applyBidirectionalValues, applyCircleValues, bidirectionalTextLines, circleTextLines, cobbTextLines, exchangeValue, ExchangeAngleTool,
  ExchangeBidirectionalTool, ExchangeCircleROITool, ExchangeCobbAngleTool, ExchangeLengthTool, registerExchangeAngleTools,
};
