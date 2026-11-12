// Angle and Cobb angle mappings for Cornerstone Tools (Legacy/Classic) v4. The tools keep named
// handles (Angle: start, middle, end; CobbAngle: start, end, start2, end2) and the value as
// `rAngle`; the measurement carries the handle points in that order. A measurement hydrated from
// DICOM-SR also carries its tracking identity, coordinate domain and source geometry, which the SR
// writer reuses. Patient points map to image points as DICOM defines them (DICOMSR angleGeometry),
// the mapping hydration and the writer use. A Cobb angle also carries the values its viewport label
// shows (`viewportValues`, chosen from its detail card); its label text is redrawn when they change.

import _ from 'lodash';

import { metaData as c3dCoreMetaData } from '@cornerstonejs/core';

import OHIF from '@ohif/core';
const { log, utils } = OHIF;

import {
  commonToAnnotation,
  commonCleanAnnotation,
  commonToAltSourceMeasurementSchema,
  measurementServiceMappingTools,
} from './common.js';

const HANDLE_NAMES = {
  Angle: ['start', 'middle', 'end'],
  CobbAngle: ['start', 'end', 'start2', 'end2'],
};

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


const toHandle = point => (_.isArray(point) ? { x: point[0], y: point[1] } : { x: point.x, y: point.y });

function handlesOf(toolName, handles, points) {
  // Named handles from the tool's own handles, or from ordered points when those are incomplete
  const names = HANDLE_NAMES[toolName];
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

const pointsOf = (toolName, handles) => HANDLE_NAMES[toolName]
  .filter(name => handles && handles[name])
  .map(name => ({ x: handles[name].x, y: handles[name].y }));

function storedAngle(measurement) {
  // rAngle of a classic measurement, or the value of a Cornerstone3D one (cachedStats by image)
  const data = measurement.data || {};
  const stats = measurement.referencedImageId && data[`imageId:${measurement.referencedImageId}`];
  const anyStats = _.find(_.values(data), value => _.isObject(value) && _.isFinite(value.angle));
  return utils.dataProc.firstDefinedValue(data.rAngle, measurement.rAngle, stats && stats.angle, anyStats && anyStats.angle);
}

/** The values a measurement shows in its viewport label, from the first section that has them */
const viewportValuesOf = (...sections) => sections
  .flatMap(section => (section ? [section.viewportValues, section.metadata && section.metadata.viewportValues] : []))
  .find(Array.isArray);

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


function angleMapping(toolName) {
  return {
    toolName,

    toAnnotation: (measurementService, measurement, definition) => {
      // Map measurement format to Cornerstone Tools (Legacy/Classic) v4 format
      const annotation = commonToAnnotation(measurementService, measurement, definition);
      const measurementData = measurement.data || measurement;
      const measurementMeta = measurement.metadata || {};
      const annotationData = annotation.measurementData;

      const handles = handlesOf(toolName, measurementData.handles, measurement.points);
      const rAngle = storedAngle(measurement);
      const attributes = srAttributes(measurementMeta, measurementData, measurement);

      // cornerstone-tools reads the handles and the value at the top of its tool data. Its Cobb angle
      // draws the second line, and stops offering the measurement for completion, only once it is
      // complete: a measurement with all four points is, unless it is one still being drawn.
      const complete = toolName !== 'CobbAngle' ? undefined
        : !(measurementData.complete === false || measurement.complete === false);
      const toolFields = complete === undefined ? { handles, rAngle } : { handles, rAngle, complete };
      const viewportValues = toolName === 'CobbAngle' && viewportValuesOf(measurementMeta, measurementData, measurement);
      if (viewportValues) {
        // The stock renderer draws `value` (the label text) and computes it only while it is empty
        Object.assign(toolFields, { viewportValues: [...viewportValues], value: undefined });
      }
      _.extend(annotationData, toolFields, attributes);
      _.extend(annotation.metadata, attributes);
      _.extend(annotation, toolFields);

      log.debug(`[cornerstone:measurement:${toolName}:toAnnotation] output annotation`, annotation);
      return annotation;
    },

    toMeasurement: (measurementService, csToolsAnnotation) => {
      // Map Cornerstone Tools (Legacy/Classic) to OHIF v3 Measurement Schema
      const measurement = measurementServiceMappingTools.annotation2measurement
        .measurementCoreAttrs(measurementService, csToolsAnnotation);

      // The tool's live data first: cornerstone-tools moves the handles and sets `complete` on the
      // tool data, while a representation's nested `measurementData` keeps the copy it was made
      // with (for a Cobb angle, the first-step placeholders and `complete: false`)
      const live = [csToolsAnnotation, csToolsAnnotation.measurementData].filter(Boolean);
      const liveHandles = live.map(section => section.handles).find(Boolean);
      if (liveHandles) {
        measurement.data.handles = liveHandles;
      }
      if (toolName === 'CobbAngle') {
        const complete = live.map(section => section.complete).find(value => typeof value === 'boolean');
        if (complete !== undefined) {
          measurement.data.complete = complete;
        }
      }
      const handles = measurement.data.handles;

      // The value stays in `data`: the service accepts only its schema keys at the top level
      const annotation = csToolsAnnotation.measurementData || csToolsAnnotation;
      measurement.points = pointsOf(toolName, handles);
      measurement.data.rAngle = utils.dataProc.firstDefinedValue(
        csToolsAnnotation.rAngle, annotation.rAngle, measurement.data.rAngle);
      measurement.type = measurementService.VALUE_TYPES.ANGLE;
      measurement.unit = '°';
      const viewportValues = toolName === 'CobbAngle' && viewportValuesOf(...live);
      if (viewportValues) {
        measurement.data.viewportValues = [...viewportValues];
        measurement.metadata.viewportValues = [...viewportValues];
      }
      _.extend(measurement.metadata, srAttributes(measurement.metadata, annotation, csToolsAnnotation.metadata));

      return measurement;
    },

    toAltSourceMeasurementSchema: (measurementService, dstSrc, measurement, src) => {
      // Convert a Cornerstone 3D measurement (world points, value in cachedStats) to the
      // Cornerstone Tools schema (image points, named handles, rAngle)
      const newMeasurement = commonToAltSourceMeasurementSchema(measurementService, dstSrc, measurement, src);
      if (!newMeasurement) {
        log.warn(`[cornerstone:measurement:${toolName}:toAltSourceMeasurementSchema] unable to convert measurement`);
        return null;
      }

      const { isPlane, patientToImage } = OHIF.DICOMSR.angleGeometry;
      const module = c3dCoreMetaData.get('imagePlaneModule', measurement.referencedImageId);
      if (!isPlane(module) || !measurement.points) {
        log.warn(`[cornerstone:measurement:${toolName}:toAltSourceMeasurementSchema] no image plane for `
          + `imageId=${measurement.referencedImageId}`);
        return null;
      }
      newMeasurement.points = measurement.points.map(point => patientToImage(module, point));

      const names = HANDLE_NAMES[toolName];
      if (newMeasurement.points.length !== names.length) {
        log.warn(`[cornerstone:measurement:${toolName}:toAltSourceMeasurementSchema] expected ${names.length} points`,
          newMeasurement.points);
        return null;
      }

      newMeasurement.data = {
        ..._.pick(newMeasurement.data || {}, 'label', 'displayAttributes'),
        handles: handlesOf(toolName, undefined, newMeasurement.points),
        rAngle: storedAngle(measurement),
      };
      newMeasurement.metadata = _.extend(newMeasurement.metadata || {}, srAttributes(measurement.metadata));
      if (!newMeasurement.description && measurement.metadata?.description) {
        newMeasurement.description = measurement.metadata.description;
      }

      return _.omit(newMeasurement, 'textBox');
    },

    cleanAnnotation: commonCleanAnnotation,
  };
}


const Angle = angleMapping('Angle');
const CobbAngle = angleMapping('CobbAngle');


export default Angle;
export { Angle, CobbAngle, HANDLE_NAMES };
