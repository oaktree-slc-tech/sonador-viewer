// Bidirectional mapping for Cornerstone Tools (Legacy/Classic) v4 (`Bidirectional`). The tool keeps
// the handles `start`, `end` (the long axis) and `perpendicularStart`, `perpendicularEnd` (the short
// axis), and the two lengths as `longestDiameter` and `shortestDiameter` (DICOMSR
// bidirectionalGeometry.js); the measurement carries the four points in that order and the lengths
// in `data`, each in its own unit (`unit`, `widthUnit`: millimetres unless read in another). A
// measurement hydrated from DICOM-SR (a Cornerstone3D `Bidirectional`, points[0..3] in
// the same order, in world coordinates) also carries its tracking identity, coordinate domain and
// source geometry, which the SR writer reuses, and keeps each stored length while its axis is
// unchanged: the tool is given the lengths with the image points they belong to (`recordValue`).

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

const TOOL_NAME = 'Bidirectional';

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

const geometry = () => OHIF.DICOMSR.bidirectionalGeometry;
const handleNames = () => geometry().HANDLE_NAMES;

const toHandle = point => (_.isArray(point) ? { x: point[0], y: point[1] } : { x: point.x, y: point.y });

function handlesOf(handles, points) {
  // Named handles from the tool's own handles, or from the four ordered points; the short axis is
  // never re-placed by the tool's creation step (`locked`)
  const names = handleNames();
  const complete = handles && names.every(name => handles[name] && _.isFinite(handles[name].x) && _.isFinite(handles[name].y));
  let named;
  if (complete) {
    named = _.defaults(_.cloneDeep(handles), { textBox: { ...TEXT_BOX } });
  } else if (points && points.length === names.length) {
    named = {
      ..._.zipObject(names, points.map(point => ({ ...toHandle(point), highlight: true, active: false }))),
      textBox: { ...TEXT_BOX },
    };
  } else {
    return handles;
  }
  named.perpendicularStart = { ...named.perpendicularStart, locked: false };
  return named;
}

const pointsOf = handles => handleNames()
  .filter(name => handles && handles[name])
  .map(name => ({ x: handles[name].x, y: handles[name].y }));

/** The lengths of a measurement, wherever it holds them: { length, width, unit }, or undefined */
const storedValues = measurement => geometry().bidirectionalDisplayValues(measurement);

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

/** The tool data fields of lengths held with their handles */
function valueFields(values, handles) {
  if (!values || !_.isFinite(values.length)) {
    return {};
  }
  const { long, short } = geometry().CLASSIC_VALUE_NAMES;
  const points = pointsOf(handles).map(({ x, y }) => [x, y]);
  const units = { unit: values.unit || 'mm', widthUnit: values.widthUnit || values.unit || 'mm' };
  return {
    [long]: values.length,
    [short]: values.width,
    ...units,
    ...(points.length === 4 ? { recordValue: { values: { length: values.length, width: values.width, ...units }, points } } : {}),
  };
}


const Bidirectional = {
  toolName: TOOL_NAME,

  toAnnotation: (measurementService, measurement, definition) => {
    // Map measurement format to Cornerstone Tools (Legacy/Classic) v4 format
    const annotation = commonToAnnotation(measurementService, measurement, definition);
    const measurementData = measurement.data || measurement;
    const measurementMeta = measurement.metadata || {};
    const annotationData = annotation.measurementData;

    const handles = handlesOf(measurementData.handles, measurement.points);
    const attributes = srAttributes(measurementMeta, measurementData, measurement);

    // cornerstone-tools reads the handles and the lengths at the top of its tool data
    const toolFields = { handles, ...valueFields(storedValues(measurement), handles) };
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

    // The tool's live data first: cornerstone-tools moves the handles and computes the lengths on
    // the tool data, while a representation's nested `measurementData` keeps the copy it was made with
    const live = [csToolsAnnotation, csToolsAnnotation.measurementData].filter(Boolean);
    const liveHandles = live.map(section => section.handles).find(Boolean);
    if (liveHandles) {
      measurement.data.handles = liveHandles;
    }
    const { long, short } = geometry().CLASSIC_VALUE_NAMES;
    const liveValues = live.find(section => !_.isNil(section[long]) && _.isFinite(Number(section[long])));
    measurement.points = pointsOf(measurement.data.handles);
    const unit = (liveValues && liveValues.unit) || 'mm';
    if (liveValues) {
      measurement.data[long] = Number(liveValues[long]);
      measurement.data[short] = Number(liveValues[short]);
      measurement.data.unit = unit;
      measurement.data.widthUnit = liveValues.widthUnit || unit;
    }
    measurement.data = _.omit(measurement.data, 'recordValue');
    measurement.type = measurementService.VALUE_TYPES.BIDIRECTIONAL;
    measurement.unit = unit;
    const annotation = csToolsAnnotation.measurementData || csToolsAnnotation;
    _.extend(measurement.metadata, srAttributes(measurement.metadata, annotation, csToolsAnnotation.metadata));

    return measurement;
  },

  toAltSourceMeasurementSchema: (measurementService, dstSrc, measurement, src) => {
    // Convert a Cornerstone 3D Bidirectional (world points, lengths in cachedStats) to the Cornerstone
    // Tools schema (image points, named handles, longestDiameter / shortestDiameter)
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
    if (newMeasurement.points.length !== handleNames().length) {
      log.warn(`[cornerstone:measurement:${TOOL_NAME}:toAltSourceMeasurementSchema] expected 4 points`, newMeasurement.points);
      return null;
    }

    const values = storedValues(measurement);
    const { long, short } = geometry().CLASSIC_VALUE_NAMES;
    newMeasurement.data = {
      ..._.pick(newMeasurement.data || {}, 'label', 'displayAttributes'),
      handles: handlesOf(undefined, newMeasurement.points),
      ...(values ? { [long]: values.length, [short]: values.width, unit: values.unit, widthUnit: values.widthUnit } : {}),
    };
    newMeasurement.unit = (values && values.unit) || 'mm';
    newMeasurement.toolName = TOOL_NAME;
    newMeasurement.metadata = _.extend(newMeasurement.metadata || {}, srAttributes(measurement.metadata), { toolName: TOOL_NAME });
    if (!newMeasurement.description && measurement.metadata?.description) {
      newMeasurement.description = measurement.metadata.description;
    }

    return _.omit(newMeasurement, 'textBox');
  },

  cleanAnnotation: commonCleanAnnotation,
};


export default Bidirectional;
export { Bidirectional };
