// DICOMSRSeriesTagTool service mapping. Annotation data schema:

// @attr value (str): coded concept value for the tag
// @attr text (str): code meaning to be displayed for the concept
// @attr scheme (str): encoding scheme that the value and text are taken from
// @attr schemeVersion (str): version of the encoding scheme which defines
//    the attribute.

import _ from 'lodash';

import OHIF from '@ohif/core';
const { log, utils } = OHIF;

import {
  measurementServiceMappingTools,
  commonCleanAnnotation,
  commonToAltSourceMeasurementSchema,
} from './common.js';


const DICOMSRSeriesTagTool = {
  toolName: OHIF.DICOMSR.SREnums.TOOL_NAMES.DICOM_SR_SERIES_TAG,

  toAnnotation: (measurementService, measurement, definition) => {
    // Map measurement format to Conrerstone Tools (Legacy/Classic) v4 format    

    const {
      uid,
      label,
      description,
      SOPInstanceUID,
      FrameOfReferenceUID,
      referenceSeriesUID,
      referenceStudyUID,
      referencedImageId,
      frameNumber,
      isVisible,
      value,
    } = measurement;
    let { isLocked } = measurement

    const { measurementMeta, measurementData } = measurementServiceMappingTools.measurement2annotation.annotationDataSections(measurement);
    const {
      _id,
      timepointId,
      measurementNumber,
      SeriesInstanceUID,
      StudyInstanceUID,
      trackingUid
    } = measurementServiceMappingTools.measurement2annotation.annotationUids(measurement);

    // State of the measurement/annotation
    isLocked = utils.dataProc.firstDefinedValue(isLocked, measurementMeta.isLocked, measurementData.isLocked);
    const isReadOnly = utils.dataProc.firstDefinedValue(measurementMeta.isReadOnly, measurementData.isReadOnly);

    const _measurementNumber = measurementNumber || measurementMeta.measurementNumber 
      || measurementData.measurementNumber || measurement.measurementNumber;

    // Ensure that value, text, description, and metadata properties are populated correctly
    const annotation = _.pick(measurement, 'description', 'metadata');
    _.extend(annotation, {
      SOPInstanceUID, uid, _id, timepointId,
      toolName: definition, toolType: definition,
      measurementNumber: _measurementNumber,
      timepointId,
      visible: isVisible,
      value: measurement.value || measurementData.value || measurementMeta.value,
      text: measurementMeta.text || measurementData.text || measurement.text,
    });
    annotation.metadata = _.extend(measurementMeta || {}, {
      _id, referencedImageId,
      SeriesInstanceUID: SeriesInstanceUID || measurementMeta.SeriesInstanceUID,
      StudyInstanceUID: StudyInstanceUID || measurementMeta.StudyInstanceUID,
      PatientID: measurementMeta.PatientID,
      isLocked, isReadOnly,
      measurementNumber: _measurementNumber,
      timepointId,
      TrackingUniqueIdentifier: trackingUid,
      scheme: measurementMeta.scheme || measurementData.scheme || measurement.scheme,
      schemeVersion: measurementMeta.schemeVersion || measurementData.schemeVersion || measurement.schemeVersion,
    });

    return _.omit(annotation, 'data');
  },

  toMeasurement: (measurementService, csToolsAnnotation) => {
    // Map Cornerstone Tools (Legacy/Classic) to OHIF v3 Measurement Schema

    const _annotation = _.cloneDeep(csToolsAnnotation);
    const { annotation } = measurementServiceMappingTools.annotation2measurement.measurementDataSections(
      csToolsAnnotation, _annotation);

    // Care core measurement attributes
    const measurement = measurementServiceMappingTools.annotation2measurement.measurementCoreAttrs(measurementService, csToolsAnnotation);
    const { data: measurementData, metadata: measurementMeta } = measurement;

    // Tag value
    const value = csToolsAnnotation.value || measurementData.value || annotation.value;
    const scheme = csToolsAnnotation.scheme || measurementMeta.scheme || measurementData.scheme || annotation.scheme;
    const schemeVersion = csToolsAnnotation.schemeVersion || measurementMeta.schemeVersion || measurementData.schemeVersion || annotation.schemeVersion;

    // Add tag value to measurement root and measurement data sections
    measurement.data.value = value;
    measurement.value = value;
    _.extend(measurement.metadata, {
      scheme, schemeVersion,
      measurementNumber: csToolsAnnotation.measurementNumber || measurementMeta.measurementNumber || measurementData.measurementNumber
        || annotation.measurementNumber || annotation.data?.measurementNumber || annotation.metadata?.measurementNumber,
    });

    return _.omit(measurement, 'measurementData');
  },

  toAltSourceMeasurementSchema: (measurementService, dstSrc, measurement, src) => {
    // Convert the prvoded measurement instance to the schema of the provided source

    // Convert common properties to the destination 
    return commonToAltSourceMeasurementSchema(measurementService, dstSrc, measurement, src);
  },

  cleanAnnotation: commonCleanAnnotation,
}


export default DICOMSRSeriesTagTool;
export { DICOMSRSeriesTagTool, };