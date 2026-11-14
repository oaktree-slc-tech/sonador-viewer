// Arrow annotation mapping for Cornerstone Tools (Legacy/Classic) v4 (`ArrowAnnotate`). The tool keeps
// the handles `start` (the tip) and `end` (the tail) and its text in `text`, which it draws (DICOMSR
// arrowGeometry.js). The measurement carries the two points, tip then tail, and the text as its label
// (and as `metadata.text`, which the Cornerstone3D mirror reads first). The arrow's text, its
// description, its Sonador-Measurement.Text (`metadata.measurementText`) and its location are four
// fields, none written from another. A measurement hydrated from DICOM-SR (a Cornerstone3D
// `ArrowAnnotate`, points[0] the tip and points[1] the tail in world coordinates) also carries its
// tracking identity, coordinate domain, source geometry and the code read, which the SR writer
// reuses; a coded finding is shown by its meaning and has no text of its own.
//
// A record rebuilt from tool data that holds no text (the Measurements API's copy of an arrow taken
// before its label was typed, as a location edit sends it) keeps the label of the service's record,
// and the fields only the record holds: a text the tool data holds, an empty one included, is the
// arrow's label.

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

const TOOL_NAME = 'ArrowAnnotate';

// Attributes of a hydrated measurement that a re-save writes back unchanged, and the arrow's own
// Sonador-Measurement.Text
const SR_ATTRIBUTES = [
  'TrackingUniqueIdentifier', 'TrackingIdentifier', 'coordinateDomain', 'views', 'sourceGeometry', 'finding', 'codedFinding',
  'measurementText',
];

const TEXT_BOX = {
  active: false,
  hasMoved: false,
  movesIndependently: false,
  drawnIndependently: true,
  allowedOutsideImage: true,
  hasBoundingBox: true,
};

const geometry = () => OHIF.DICOMSR.arrowGeometry;

const toHandle = point => (_.isArray(point) ? { x: point[0], y: point[1] } : { x: point.x, y: point.y });

function handlesOf(handles, points) {
  // Named handles from the tool's own handles, or from the two ordered points
  const names = geometry().HANDLE_NAMES;
  const complete = handles && names.every(name => handles[name] && _.isFinite(handles[name].x) && _.isFinite(handles[name].y));
  if (complete) {
    return _.defaults(_.cloneDeep(handles), { textBox: { ...TEXT_BOX } });
  }
  if (points && points.length === names.length) {
    return {
      ..._.zipObject(names, points.map(point => ({ ...toHandle(point), highlight: true, active: false }))),
      textBox: { ...TEXT_BOX },
    };
  }
  return handles;
}

const pointsOf = handles => geometry().HANDLE_NAMES
  .filter(name => handles && handles[name])
  .map(name => ({ x: handles[name].x, y: handles[name].y }));

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

/** The arrow's own text: its label (the meaning of a coded finding is not one) */
const textOf = measurement => [measurement.metadata && measurement.metadata.text, measurement.label,
  measurement.data && measurement.data.text].find(value => _.isString(value) && value !== '') || '';

/** The text an arrow's tool draws: its own, else its coded finding's meaning */
const shownTextOf = (text, metadata) => geometry().arrowDisplayText(text, metadata && metadata.codedFinding);


const ArrowAnnotate = {
  toolName: TOOL_NAME,

  toAnnotation: (measurementService, measurement, definition) => {
    // Map measurement format to Cornerstone Tools (Legacy/Classic) v4 format
    const annotation = commonToAnnotation(measurementService, measurement, definition);
    const measurementData = measurement.data || measurement;
    const measurementMeta = measurement.metadata || {};
    const annotationData = annotation.measurementData;

    const handles = handlesOf(measurementData.handles, measurement.points);
    const attributes = srAttributes(measurementMeta, measurementData, measurement);
    const text = shownTextOf(textOf(measurement), attributes);

    // cornerstone-tools reads the handles and the text at the top of its tool data; the description
    // and the location are the measurement's, never the text
    const toolFields = { handles, text };
    _.extend(annotationData, toolFields, attributes, { label: textOf(measurement) });
    _.extend(annotation.metadata, attributes, { location: measurementMeta.location });
    _.extend(annotation, toolFields);

    log.debug(`[cornerstone:measurement:${TOOL_NAME}:toAnnotation] output annotation`, annotation);
    return annotation;
  },

  toMeasurement: (measurementService, csToolsAnnotation) => {
    // Map Cornerstone Tools (Legacy/Classic) to OHIF v3 Measurement Schema
    const measurement = measurementServiceMappingTools.annotation2measurement
      .measurementCoreAttrs(measurementService, csToolsAnnotation);

    // The tool's live data first: cornerstone-tools moves the handles and sets the text on its tool
    // data, while a representation's nested `measurementData` keeps the copy it was made with
    const live = [csToolsAnnotation, csToolsAnnotation.measurementData].filter(Boolean);
    const liveHandles = live.map(section => section.handles).find(Boolean);
    if (liveHandles) {
      measurement.data.handles = liveHandles;
    }
    measurement.points = pointsOf(measurement.data.handles);

    // The service's record, for what tool data without the arrow's text lacks
    const record = measurement.uid && _.isFunction(measurementService.getMeasurement)
      ? measurementService.getMeasurement(measurement.uid) : undefined;

    const annotation = csToolsAnnotation.measurementData || csToolsAnnotation;
    _.extend(measurement.metadata, srAttributes(measurement.metadata, annotation, annotation.metadata, csToolsAnnotation.metadata,
      record && record.metadata));

    // The text the tool data holds, its label; the meaning of a coded finding it shows is not one
    const held = live.map(section => section.text).find(_.isString);
    let text = _.isString(held) ? held : textOf(measurement);
    if (!_.isString(held) && !text && record) {
      text = textOf(record);
    }
    const coded = measurement.metadata.codedFinding;
    if (coded && text === coded.CodeMeaning) {
      text = '';
    }
    measurement.label = text;
    measurement.metadata.text = text;
    measurement.data = _.omit(measurement.data, 'text', 'label');
    measurement.type = measurementService.VALUE_TYPES.POINT;

    return measurement;
  },

  toAltSourceMeasurementSchema: (measurementService, dstSrc, measurement, src) => {
    // Convert a Cornerstone 3D arrow (world points, tip then tail, the text as its label) to the
    // Cornerstone Tools schema (image points, the `start` and `end` handles, `text`)
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
    if (newMeasurement.points.length !== geometry().HANDLE_NAMES.length) {
      log.warn(`[cornerstone:measurement:${TOOL_NAME}:toAltSourceMeasurementSchema] expected 2 points`, newMeasurement.points);
      return null;
    }

    const attributes = srAttributes(measurement.metadata);
    const text = measurement.label || '';
    newMeasurement.label = text;
    newMeasurement.data = {
      ..._.pick(newMeasurement.data || {}, 'displayAttributes'),
      handles: handlesOf(undefined, newMeasurement.points),
      text: shownTextOf(text, attributes),
    };
    newMeasurement.toolName = TOOL_NAME;
    newMeasurement.metadata = _.extend(newMeasurement.metadata || {}, attributes, { toolName: TOOL_NAME, text });
    if (!newMeasurement.description && measurement.metadata?.description) {
      newMeasurement.description = measurement.metadata.description;
    }

    return _.omit(newMeasurement, 'textBox');
  },

  cleanAnnotation: commonCleanAnnotation,
};


export default ArrowAnnotate;
export { ArrowAnnotate };
