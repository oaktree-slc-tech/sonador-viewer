// Circle mapping for Cornerstone Tools (Legacy/Classic) v4 (`CircleRoi`). The tool keeps the
// handles `start`, the center, and `end`, a point on the circumference, and its values (radius,
// area, perimeter, DICOMSR circleGeometry.js) as `cachedStats`; the measurement carries the two
// points in that order and the values in `data.cachedStats`. The values keep their unit: pixels on
// an image without calibration, millimetres otherwise. The pixel statistics the tools compute (mean,
// standard deviation, maximum and their unit) travel with them, and so does the measurement's
// choice of the values its viewport label shows (`viewportValues`). A measurement hydrated from DICOM-SR
// (a Cornerstone3D `CircleROI` with world points) also carries its tracking identity, coordinate
// domain and source geometry, which the SR writer reuses, and keeps its stored values while its
// handles are unchanged.

import _ from 'lodash';

import { metaData as c3dCoreMetaData } from '@cornerstonejs/core';

import OHIF from '@ohif/core';
const { log } = OHIF;

import {
  commonToAnnotation,
  commonCleanAnnotation,
  commonToAltSourceMeasurementSchema,
  measurementServiceMappingTools,
} from './common.js';

const TOOL_NAME = 'CircleRoi';
const HANDLE_NAMES = { [TOOL_NAME]: ['start', 'end'] };

// Attributes of a hydrated measurement that a re-save writes back unchanged
const SR_ATTRIBUTES = ['TrackingUniqueIdentifier', 'TrackingIdentifier', 'coordinateDomain', 'views', 'sourceGeometry'];

const TEXT_BOX = {
  active: false,
  hasMoved: false,
  movesIndependently: false,
  drawnIndependently: true,
  allowedOutsideImage: true,
  hasBoundingBox: true,
};

const VALUE_KEYS = ['radius', 'area', 'perimeter', 'mean', 'stdDev', 'max', 'modalityUnit'];

/** The values a measurement shows in its viewport label, from the first section that has them */
const viewportValuesOf = (...sections) => sections
  .flatMap(section => (section ? [section.viewportValues, section.metadata && section.metadata.viewportValues] : []))
  .find(Array.isArray);

const toHandle = point => (_.isArray(point) ? { x: point[0], y: point[1] } : { x: point.x, y: point.y });

function handlesOf(handles, points) {
  // Named handles from the tool's own handles, or from the two ordered points
  const names = HANDLE_NAMES[TOOL_NAME];
  const complete = handles && names.every(name => handles[name] && _.isFinite(handles[name].x) && _.isFinite(handles[name].y));
  if (complete) {
    return _.defaults(_.cloneDeep(handles), { textBox: { ...TEXT_BOX } });
  }
  if (points && points.length === names.length) {
    const named = _.zipObject(names, points.map(point => ({ ...toHandle(point), highlight: true, active: false })));
    return { ...named, textBox: { ...TEXT_BOX } };
  }
  return handles;
}

const pointsOf = handles => HANDLE_NAMES[TOOL_NAME]
  .filter(name => handles && handles[name])
  .map(name => ({ x: handles[name].x, y: handles[name].y }));

const valuesOf = stats => ({ ..._.pick(stats, VALUE_KEYS), unit: OHIF.DICOMSR.circleGeometry.circleUnit(stats) });

/**
 * The values of a circle measurement: a classic one's `cachedStats`, or a Cornerstone3D one's
 * statistics by image, with their unit; undefined without a finite radius.
 */
function storedCircle(measurement) {
  const data = measurement.data || {};
  const candidates = [
    data.cachedStats,
    measurement.cachedStats,
    measurement.referencedImageId && data[`imageId:${measurement.referencedImageId}`],
    ..._.values(data).filter(_.isObject),
  ];
  const stats = candidates.find(value => value && _.isFinite(value.radius));
  return stats ? valuesOf(stats) : undefined;
}

function srAttributes(...sources) {
  const result = {};
  SR_ATTRIBUTES.forEach(key => {
    const source = sources.find(item => item && !_.isNil(item[key]));
    if (source) {
      result[key] = _.cloneDeep(source[key]);
    }
  });
  return result;
}


const CircleRoi = {
  toolName: TOOL_NAME,

  toAnnotation: (measurementService, measurement, definition) => {
    // Map measurement format to Cornerstone Tools (Legacy/Classic) v4 format
    const annotation = commonToAnnotation(measurementService, measurement, definition);
    const measurementData = measurement.data || measurement;
    const measurementMeta = measurement.metadata || {};
    const annotationData = annotation.measurementData;

    const handles = handlesOf(measurementData.handles, measurement.points);
    const cachedStats = storedCircle(measurement);
    const attributes = srAttributes(measurementMeta, measurementData, measurement);

    // cornerstone-tools reads the handles and the values at the top of its tool data
    const viewportValues = viewportValuesOf(measurementMeta, measurementData, measurement);
    const toolFields = {
      handles, ...(cachedStats ? { cachedStats } : {}), ...(viewportValues ? { viewportValues: [...viewportValues] } : {}),
    };
    _.extend(annotationData, toolFields, attributes);
    _.extend(annotation.metadata, attributes);
    _.extend(annotation, toolFields);

    log.debug(`[cornerstone:measurement:${TOOL_NAME}:toAnnotation] output annotation`, annotation);
    return annotation;
  },

  toMeasurement: (measurementService, csToolsAnnotation) => {
    // Map Cornerstone Tools (Legacy/Classic) to OHIF v3 Measurement Schema
    const measurement = measurementServiceMappingTools.annotation2measurement
      .measurementCoreAttrs(measurementService, csToolsAnnotation);

    // The tool's live data first: cornerstone-tools moves the handles and computes the values on
    // the tool data, while a representation's nested `measurementData` keeps the copy it was made with
    const live = [csToolsAnnotation, csToolsAnnotation.measurementData].filter(Boolean);
    const liveHandles = live.map(section => section.handles).find(Boolean);
    if (liveHandles) {
      measurement.data.handles = liveHandles;
    }
    const liveStats = live.map(section => section.cachedStats).find(stats => stats && _.isFinite(stats.radius));
    measurement.points = pointsOf(measurement.data.handles);
    if (liveStats) {
      measurement.data.cachedStats = valuesOf(liveStats);
    }
    measurement.type = measurementService.VALUE_TYPES.CIRCLE;
    measurement.unit = OHIF.DICOMSR.circleGeometry.circleUnit(measurement.data.cachedStats);
    const viewportValues = viewportValuesOf(...live);
    if (viewportValues) {
      measurement.data.viewportValues = [...viewportValues];
      measurement.metadata.viewportValues = [...viewportValues];
    }
    const annotation = csToolsAnnotation.measurementData || csToolsAnnotation;
    _.extend(measurement.metadata, srAttributes(measurement.metadata, annotation, csToolsAnnotation.metadata));

    return measurement;
  },

  toAltSourceMeasurementSchema: (measurementService, dstSrc, measurement, src) => {
    // Convert a Cornerstone 3D circle (world points, values in cachedStats) to the Cornerstone Tools
    // schema (image points, named handles, cachedStats)
    const newMeasurement = commonToAltSourceMeasurementSchema(measurementService, dstSrc, measurement, src);
    if (!newMeasurement) {
      log.warn(`[cornerstone:measurement:${TOOL_NAME}:toAltSourceMeasurementSchema] unable to convert measurement`);
      return null;
    }

    const { isPlane, patientToImage } = OHIF.DICOMSR.angleGeometry;
    const module = c3dCoreMetaData.get('imagePlaneModule', measurement.referencedImageId);
    if (!isPlane(module) || !measurement.points) {
      log.warn(`[cornerstone:measurement:${TOOL_NAME}:toAltSourceMeasurementSchema] no image plane for `
        + `imageId=${measurement.referencedImageId}`);
      return null;
    }
    newMeasurement.points = measurement.points.map(point => patientToImage(module, point));
    if (newMeasurement.points.length !== HANDLE_NAMES[TOOL_NAME].length) {
      log.warn(`[cornerstone:measurement:${TOOL_NAME}:toAltSourceMeasurementSchema] expected 2 points`, newMeasurement.points);
      return null;
    }

    const cachedStats = storedCircle(measurement);
    newMeasurement.data = {
      ..._.pick(newMeasurement.data || {}, 'label', 'displayAttributes'),
      handles: handlesOf(undefined, newMeasurement.points),
      ...(cachedStats ? { cachedStats } : {}),
    };
    newMeasurement.toolName = TOOL_NAME;
    newMeasurement.metadata = _.extend(newMeasurement.metadata || {}, srAttributes(measurement.metadata), { toolName: TOOL_NAME });
    if (!newMeasurement.description && measurement.metadata?.description) {
      newMeasurement.description = measurement.metadata.description;
    }

    return _.omit(newMeasurement, 'textBox');
  },

  cleanAnnotation: commonCleanAnnotation,
};


export default CircleRoi;
export { CircleRoi, HANDLE_NAMES, storedCircle };
