// Common MeasurementService data methods for Cornerstone Tools v4.

// @function commonToAnnotation: map measurement service format object to Cornerstone v4 (Legacy)
//    annotation object.
// @function commonCleanAnnotation: sanitize annotation input data to account for differences
//    in Cornerstone Tools, Cornerstone3D/adapters, and OHIF representations.
//  @function commonToMeasurement: map Cornerstone Tools v4 input data to measurement schema.

import _ from 'lodash';
import cornerstone from 'cornerstone-core';

import {
  utilities as c3dCoreUtilities, 
  metaData as c3dCoreMetaData
} from '@cornerstonejs/core';

import OHIF from '@ohif/core';

const { measurements, utils, log } = OHIF;
const { Enums: MeasurementEnums } = measurements;
const {
  CORNERSTONE_TOOLS_SOURCE_NAME, 
  CORNERSTONE_TOOLS_SOURCE_VERSION,
  CORNERSTONE_3D_TOOLS_SOURCE_NAME,
  CORNERSTONE_3D_TOOLS_SOURCE_VERSION,
} = MeasurementEnums;


const SUPPORTED_TOOLS = [
  'Length',
  'EllipticalRoi',
  'RectangleRoi',
  'ArrowAnnotate',
];


const _getValueTypeFromToolType = (measurementService, toolType) => {
    // Retrieve a value mapping associated with a tool

    const { POLYLINE, ELLIPSE, POINT } = measurementService.VALUE_TYPES;

    /* TODO: Relocate static value types */
    const TOOL_TYPE_TO_VALUE_TYPE = {
      Length: POLYLINE,
      EllipticalRoi: ELLIPSE,
      RectangleRoi: POLYLINE,
      ArrowAnnotate: POINT,
    };

    return TOOL_TYPE_TO_VALUE_TYPE[toolType];
  };


const _getPointsFromHandles = handles => {
  // Retrieve point data from event handles
  const points = [];
  
  Object.keys(handles).map(handle => {
    if (['start', 'end'].includes(handle)) {
      const point = {};
      if (handles[handle].x) point.x = handles[handle].x;
      if (handles[handle].y) point.y = handles[handle].y;
      
      if (point.x && point.y) {
        points.push(point);
      }  
    }
  });

  return points;
};


const _getAttributes = element => {
  // Retrieve attributes from display port

  const enabledElement = cornerstone.getEnabledElement(element);
  const imageId = enabledElement.image.imageId;
  const instance = cornerstone.metaData.get('instance', imageId);

  return {
    referencedImageId: imageId,
    SOPInstanceUID: instance.SOPInstanceUID,
    FrameOfReferenceUID: instance.FrameOfReferenceUID,
    SeriesInstanceUID: instance.SeriesInstanceUID,
    StudyInstanceUID: instance.StudyInstanceUID,
  };
};



const point2handle = (p, i) => {
  // Convert the point array to an object representation for Cornerstone Tools
  
  if (_.isObject(p) && p.x && p.y) {
    
    // Point already in object format, return as-i
    return p;
  } else if (_.isArray(p) && p.length == 2) {

    // (x,y): convert position notation to object
    return { x: p[0], y: p[1] }
  } else if (_.isArray(p) && p.length == 3) {

    // (x,y,z): convert position notation to object
    return { x: p[0], y: p[1], z: p[2] }
  }

  throw new Error('Unsupported point format'+p);
}


const _getHandlesFromPoints = points => {
  // Retrieve a object handle from a points array

  return points.map((p, i) => (i % 10 === 0 ? { start: point2handle(p) } : { end: point2handle(p) }))
    .reduce((obj, item) => Object.assign(obj, { ...item }), {});
};


const commonToAnnotation = (measurementService, measurement, definition) => {
  /**
  * Maps measurement service format object to Cornerstone (Legacy) annotation object.
  * The _id property, which is used throughout Cornerstone Tools (Legacy) v4 is preserved
  * to ensure that the measurement services does not accidentally cause duplicates.
  *
  * @param {Measurement} measurement The measurement instance
  * @param {string} definition The source definition
  * @return {Object} Cornerstone annotation data
  */
  let {
    uid,
    label,
    description,
    points,
    unit,
    SOPInstanceUID,
    FrameOfReferenceUID,
    referenceSeriesUID,
    referenceStudyUID,
    referencedImageId,
    frameNumber,
    isLocked,
    isVisible,
  } = measurement;

  // Retrieve metadata from measurement, include _id to allow for sync between
  // Cornerstone Tools (Legacy/Classic) and OHIF v3 MeasurementService.
  const measurementMeta = measurement.metadata || measurement;
  const measurementData = measurement.measurementData || measurement.data || measurement;
  const _id = measurementMeta._id || measurement?.data?._id || measurement._id;
  const measurementNumber = measurementMeta.measurementNumber || measurementData.measurementNumber 
    || measurement.measurementNumber;
  const timepointId = measurementMeta.timepointId || measurementData.timepointId || measurement.timepointId;

  // Study identifiers  
  const SeriesInstanceUID = referenceSeriesUID || measurementMeta.SeriesInstanceUID || measurementData.SeriesInstanceUID 
    || measurement.SeriesInstanceUID;
  const StudyInstanceUID = referenceStudyUID || measurementMeta.StudyInstanceUID || measurementData.StudyInstanceUID 
    || measurement.StudyInstanceUID;

  // Image path
  const imagePath = measurementMeta.imagePath || measurement?.data?.imagePath  || measurement.imagePath 
    referencedImageId || measurements.getImagePath(StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID, frameNumber || 1);

  // State of the measurement/annotation
  const isReadOnly = utils.dataProc.firstDefinedValue(measurementMeta.isReadOnly, measurementData.isReadOnly);

  // Location
  const location = measurementMeta.location || measurementData.location || measurement.location;

  // Back-fill description
  if (!description) {
    description = measurementMeta.description || measurementData.description;
  }

  // Measurement Tracking Unique Identifier
  const trackingUid = measurementMeta.TrackingUniqueIdentifier || measurementData.TrackingUniqueIdentifier || measurement.TrackingUniqueIdentifier;

  const annotation = {
    SOPInstanceUID,
    uid,
    toolName: definition,
    toolType: definition,
    measurementNumber,
    measurementData: {
      sopInstanceUid: SOPInstanceUID,
      frameOfReferenceUID: FrameOfReferenceUID || measurementMeta.FrameOfReferenceUID,
      SeriesInstanceUID,
      StudyInstanceUID,
      unit,
      text: measurementMeta.text || label,
      label,
      description,
      location,
      handles: _getHandlesFromPoints(points),
      _measurementServiceId: uid,
      _id,
      timepointId,
      visible: isVisible,
    },
    metadata: {
      _id,
      imagePath,
      referencedImageId,
      annotationUID: measurementMeta.annotationUID,
      SeriesInstanceUID,
      StudyInstanceUID,
      PatientID: measurementMeta.PatientID,
      isLocked,
      isReadOnly,
      measurementNumber,
      timepointId,
      TrackingUniqueIdentifier: trackingUid,
    },
    _id,
    timepointId,
    visible: isVisible,
  }

  // Back-populate _id and uid properties
  return annotation;
}


const commonCleanAnnotation = (annotation, toolType) => {
  // Apply common data transforms to the provided annotation data to help coerce it to
  // the expected measurement format.

  // 1. Check top-level annotation to see if it is an instance of Cornerstone toolData.
  //    If so, move the toolData to an output.annotation.
  // 2. Create metadata section and ensure it includes toolName.

  // Unpack top-level sections
  const _annotation = annotation;
  const { metadata } = _annotation;

  // Move annotation to object.annotation key
  if (!annotation.annotation) {
    annotation = { annotation: _annotation };
  }
  if (!annotation.metadata && metadata) {
    annotation.metadata = metadata;
  } else { annotation.metadata = {}};

  // Ensure that toolName is set on the metadata section
  if (!annotation.metadata.toolName && toolType) {
    annotation.metadata.toolName = toolType;
  } else if (!annotation.metadata.toolName && (_annotation.toolName || _annotation.toolType)) {
    annotation.metadata.toolName = _annotation.toolName || _annotation.toolType;
  }

  return annotation;
}


const commonCleanInnerData = (measurementData, annotation, options) => {
  // Compare handles structures for the measurement data and annotation match. If there are discrepancies,
  // copy the annotation data to the measurement.
  options = options || {};

  // Create a copy of the inner data for cleaning
  const _data = _.cloneDeep(measurementData);

  const { data: innerData } = measurementData;

  // Remove nested copy of measurementData.data and copy properties to root structure (if presented)
  if (innerData) {
    _.defaults(_data, _.pick(innerData, _.keys(innerData)));
  }

  // Omit nested copy of inner data to prevent attribute collisions   
  return _.omit(_data, 'data');
}


const commonToMeasurement = (measurementService, csToolsAnnotation) => {
  /**
  * Maps cornerstone annotation event data to measurement service format.
  *
  * @param csToolsAnnotation {Object} cornerstone Cornerstone event data.
  * @return {Measurement} Measurement instance
  */
  // For tools annotations that contain both "data" and "measurementData" sections, ensure
  // that measurementData is back-populated with the attributes from data. _.defaults 
  // is used to prevent over-writing the same keys in measurement data.
  if (csToolsAnnotation.measurementData && csToolsAnnotation.data) {
    _.defaults(csToolsAnnotation.measurementData, csToolsAnnotation.data);
  }

  // Create copy of annotation data before clean, unpack tool attributes
  let _annotation = _.cloneDeep(csToolsAnnotation);
  const { element } = _annotation;

  // Clean inputs and unpack toolData to annotation and components
  _annotation = commonCleanAnnotation(_annotation);
  const annotation = _annotation.annotation || _annotation;  
  const _measurementData = annotation.measurementData || annotation.data || annotation;
  const measurementMeta = annotation.metadata || _annotation.metadata || _measurementData || _annotation;
  const tool = measurementMeta.toolName || measurementMeta.toolType || _annotation.toolName;
  const measurementNumber = measurementMeta.measurementNumber || _measurementData.measurementNumber || annotation.measurementNumber;
  const timepointId = measurementMeta.timepointId || _measurementData.timepointId || annotation.timepointId;

  // Ensure that the tool type is supported by the method
  const validToolType = toolName => SUPPORTED_TOOLS.includes(toolName);

  if (!validToolType(tool)) {
    const emsg = 'Tool not supported: "'+tool+'"';
    console.error(emsg, tool);
    throw new Error(emsg);
  }

  // Retrieve measurement UIDs
  let FrameOfReferenceUID, SOPInstanceUID, SeriesInstanceUID, StudyInstanceUID, PatientID, referencedImageId, frameNumber;

  // Unpack measurement UID data: measurement service UID, frame of reference, SOP instance, patient, study, series
  let uid =  csToolsAnnotation.uid || _measurementData.uid || _measurementData._measurementServiceId 
    || measurementMeta.uid || measurementMeta._measurementServiceId
    || csToolsAnnotation?.measurementData?.uid || csToolsAnnotation?.measurementData?._measurementServiceId;
  let _id = measurementMeta._id || _measurementData._id || _annotation._id
    || csToolsAnnotation?.measurementData?._id;

  // Back-fill uid and _id from CS Tools annotation
  if (!uid) {
    uid = csToolsAnnotation.measurementData?.uid || csToolsAnnotation.measurementData?._measurementServiceId;
  }
  if (!_id) {
    _id = csToolsAnnotation.measurementData?._id || csToolsAnnotation._id;
  }

  FrameOfReferenceUID = measurementMeta.FrameOfReferenceUID || _measurementData.FrameOfReferenceUID
    || annotation.FrameOcfReferenceUID || _annotation.FrameOfReferenceUID;
  SOPInstanceUID = measurementMeta.SOPInstanceUID || measurementMeta.sopInstanceUid || csToolsAnnotation.SOPInstanceUID;
  PatientID = measurementMeta.PatientID;
  StudyInstanceUID = measurementMeta.StudyInstanceUID || _measurementData.StudyInstanceUID 
    || _annotation.referenceStudyUID;
  SeriesInstanceUID = measurementMeta.SeriesInstanceUID || _measurementData.SeriesInstanceUID
    || annotation.referenceSeriesUID;
  frameNumber = _measurementData.frameIndex || _measurementData.frameIndex;

  // Retrieve UID attributes from the active element (if defined)
  let _elementAttrs;
  if ((!SOPInstanceUID || !FrameOfReferenceUID || !SeriesInstanceUID || !StudyInstanceUID) && element) {
    _elementAttrs = _getAttributes(element);
    ({ SOPInstanceUID, FrameOfReferenceUID, SeriesInstanceUID, StudyInstanceUID } = _elementAttrs);
  }

  // Retrieve reference Image ID
  referencedImageId = measurementMeta.referencedImageId || _measurementData.referencedImageId 
      || annotation.referencedImageId || _elementAttrs?.referencedImageId;

  // Retrieve reference to image path
  const imagePath = measurementMeta.imagePath || _measurementData.imagePath || _annotation.imagePath
    referencedImageId || measurements.getImagePath(StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID, frameNumber);

  // Clean handles and other display attributes, make sure they are included and up to date
  // in measurement data.
  const handles = csToolsAnnotation.handles || _measurementData.handles || annotation.handles;
  const measurementData = commonCleanInnerData(_measurementData, csToolsAnnotation);

  if (!measurementData.timepointId && timepointId) {
    measurementData.timepointId = timepointId;
  }

  let length = csToolsAnnotation.length || _measurementData.length || annotation.length;
  if (length && _.isString(length)) {
    length = _.toNumber(length);
  }

  // Measurement state attributes
  const isLocked = utils.dataProc.firstDefinedValue(measurementMeta.isLocked, measurementData.isLocked, annotation.isLocked);
  const isReadOnly = utils.dataProc.firstDefinedValue(measurementMeta.isReadOnly, measurementData.isReadOnly);
  const isVisible = utils.dataProc.firstDefinedValue(measurementMeta.isVisible, measurementData.isVisible, annotation.isVisible,
    csToolsAnnotation.visible, measurementMeta.visible, measurementData.visible, annotation.visible);

  // Description, location, label, and text attributes
  const description = csToolsAnnotation.description || measurementMeta.description || measurementData.description
    || csToolsAnnotation.annotation?.metadata?.description;
  const text = csToolsAnnotation.text || measurementMeta.text || measurementData.text 
    || csToolsAnnotation.annotation?.metadata?.text;
  const label = csToolsAnnotation.label || measurementMeta.label || measurementData.label || text;
  const location = csToolsAnnotation.location || measurementData.location || measurementMeta.location
    || csToolsAnnotation.annotation?.metadata?.text;

  // Measurement Tracking Unique Identifier
  const trackingUid = csToolsAnnotation.TrackingUniqueIdentifier || measurementMeta.TrackingUniqueIdentifier || measurementData.TrackingUniqueIdentifier;

  // Create base measurement structure
  const measurement = {
    uid,
    toolName: tool,
    
    FrameOfReferenceUID,
    SOPInstanceUID,
    referencedImageId,
    referenceSeriesUID: SeriesInstanceUID,
    referenceStudyUID: StudyInstanceUID,
    
    metadata: _.extend(measurementMeta, {
      _id,
      toolName: tool,
      StudyInstanceUID,
      SeriesInstanceUID,
      PatientID,
      isReadOnly,
      imagePath,
      measurementNumber,
      text: text || label,
      location,
      timepointId,
      TrackingUniqueIdentifier: trackingUid,
    }),
    data: _.omit(measurementData, 'handles', 'imageId', 'toolName', 'toolType', 'isReadOnly', 'isLocked', 'measurementNumber', 
      'PatientID', 'StudyInstanceUID', 'SeriesInstanceUID', 'SOPInstanceUID', 'FrameOfReferenceUID', 'imagePath', 
      'referencedImageId', 'sopInstanceUid', 'SOPInstanceUID', 'location', 'visible'),

    label: label || text,
    description,
    isLocked,
    frameNumber,

    // TODO: Add concepts to schema to allow better flexibility
    length,
    area: measurementData.cachedStats && measurementData.cachedStats.area,
    type: _getValueTypeFromToolType(measurementService, tool),
    unit: measurementData.unit || _annotation.unit,
  }

  // Ensure that handles are attached to the measurement.data property and not as top-level
  if (!measurement.data.handles && handles) {
    measurement.data.handles = handles;
  }

  // Attach points from handles
  if (measurement.data.handles) {
    measurement.points = _getPointsFromHandles(measurement.data.handles);
  }

  // Ensure that _id is embedded within measurement data
  if (!measurement.data._id && _id) {
    measurement.data._id = _id;
  }

  // Return measurement (omitting top-level keys that are part of annotation schema, but not included in measurement schema)
  return _.omit(measurement, 'handles');
}


const commonToAltSourceMeasurementSchema = (measurementService, dstSrc, measurement, src) => {
  // Convert the measurement to the schema of the provided source. This method handles conversions between
  // the 2D (x,y) points of Cornerstone Tools and the 3D (x,y,z) points of Cornerstone 3D.

  // @input measurementService: MeasurementService instance
  // @input dstSrc (MeasurementService source instance): source instance to which the measurement
  //   should be converted.
  // @input measurement (Measurement in OHIF v3 schema.): measurement instance to be converted
  // @input src (MeasurementService source instance): source instance used to create the initial
  //   initial measurement.

  // @returns new Measurement instance or null if the measurement could not be converted

  // Clone measurement and scrub identifiers and other annotation information which might cause the measurement
  // instance to be treated as a duplicate of the source measurement
  let newMeasurement = _.cloneDeep(_.omit(measurement, 'uid', 'source', 'displayText', 'getReport', 'type'));
  newMeasurement.metadata = _.omit(newMeasurement.metadata, '_id', '_measurementServiceId');
  newMeasurement.data = _.omit(newMeasurement.data, '_id', '_measurementServiceId');

  // Pull source of the original measurement if one was not provided.  
  src = src || measurement.source;

  // Destination and source match, no conversion needed
  if (dstSrc.name == src.name && dstSrc.version == src.version) {
    
    log.warn('[cornerstone:measurement:common:toAltSourceMeasurementSchema] destination and source match, '
      + 'no conversion needed.');
    return null;
  }

  // Check that the conversion method is supported
  if (!(dstSrc.name == CORNERSTONE_TOOLS_SOURCE_NAME && dstSrc.version == CORNERSTONE_TOOLS_SOURCE_VERSION
    && src.name == CORNERSTONE_3D_TOOLS_SOURCE_NAME && src.version == CORNERSTONE_3D_TOOLS_SOURCE_VERSION)) {
    
    // This method only supports conversion from Cornerstone 3D -> Cornerstone Tools
    log.warn('[cornerstone:measurement:common:toAltSourceMeasurementSchema] this method only supports converstion from '
      + 'Cornerstone 3D to Cornerstone tools.');
    return null;
  }

  // Cornerstone 3D uses world coordinates for tracking all measurements while Cornerstone Tools uses
  // 2D (x,y) coordinates specified as an object.
  if (measurement.points) {
    newMeasurement.points = measurement.points.map((p) => c3dCoreUtilities.worldToImageCoords(measurement.referencedImageId, p));
    console.debug('[cornerstone:measurement:common:toAltSourceMeasurementSchema] convert points from 2D -> 3D', newMeasurement.points);
  }

  // Add a new representation identifier
  newMeasurement.metadata._id = utils.guid();
  newMeasurement.data._id = newMeasurement.metadata._id;

  return newMeasurement
}


const measurementServiceMappingTools = {
  commonToAnnotation,
  commonToMeasurement,
  commonCleanAnnotation,
  commonToAltSourceMeasurementSchema,
  SUPPORTED_TOOLS,
}


export default measurementServiceMappingTools;
export {
  measurementServiceMappingTools,
  commonToAnnotation,
  commonToMeasurement, 
  commonCleanAnnotation,
  commonToAltSourceMeasurementSchema,
  SUPPORTED_TOOLS
};