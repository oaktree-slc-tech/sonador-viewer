// DICOMSRSeriesTagTool service mapping. Annotation data schema:

// @attr value (str): coded concept value for the tag
// @attr text (str): code meaning to be displayed for the concept
// @attr scheme (str): encoding scheme that the value and text are taken from
// @attr schemeVersion (str): version of the encoding scheme which defines
//    the attribute.

import _ from 'lodash';

import OHIF from '@ohif/core';

import { getIsLocked } from './utils/getIsLocked';
import getSOPInstanceAttributes from './utils/getSOPInstanceAttributes';
import { getIsVisible } from './utils/getIsVisible';

const { log, utils, DICOMSR } = OHIF;


const DICOMSRSeriesTagTool = {
	toolName: OHIF.DICOMSR.SREnums.TOOL_NAMES.DICOM_SR_SERIES_TAG,
	toAnnotation: measurement => {},

	toMeasurement: (
		csToolsEventDetail,
    displaySetService,
    cornerstoneViewportService,
    getValueTypeFromToolType,
    customizationService
	) => {
		/**
   	* Maps cornerstone annotation event data to measurement service format.
   	*
   	* @param {Object} cornerstone Cornerstone event data
   	* @return {Measurement} Measurement instance
   	*/    

		const { annotation } = csToolsEventDetail;
    const { metadata, data, annotationUID } = annotation;

    // State properties
    const measurementNumber = csToolsEventDetail.measurementNumber || annotation.measurementNumber 
      || metadata.measurementNumber || data.measurementNumber;
    const isLocked = annotation.isLocked || metadata.isLocked || data.isLocked ||  getIsLocked(annotationUID);
    const isVisible = getIsVisible(annotationUID);
    const isReadOnly = annotation.isReadOnly || metadata.isReadOnly || data.isReadOnly;

    if (!metadata || !data) {
      console.warn('Length tool: Missing metadata or data');
      return null;
    }

    const { toolName, referencedImageId, FrameOfReferenceUID } = metadata;
    if (toolName != DICOMSRSeriesTagTool.toolName) {
    	throw new Error('Tool not supported');
    }

    const { SOPInstanceUID, SeriesInstanceUID, StudyInstanceUID } = getSOPInstanceAttributes(
      referencedImageId,
      displaySetService,
      annotation
    );

    let displaySet;

    if (SOPInstanceUID) {
      displaySet = displaySetService.getDisplaySetForSOPInstanceUID(
        SOPInstanceUID,
        SeriesInstanceUID
      );
    } else {
      displaySet = displaySetService.getDisplaySetsForSeries(SeriesInstanceUID)[0];
    }

    // Tag value, text, scheme, and scheme version
    const value = csToolsEventDetail.value || annotation.value || data.value;
    const scheme = csToolsEventDetail.scheme || metadata.scheme || annotation.scheme;
    const schemeVersion = csToolsEventDetail.schemeVersion || metadata.schemeVersion || annotation.schemeVersion;

    // Add tag value to measruement root and data sections
    data.value = value;
    _.extend(metadata, { 
    	scheme, schemeVersion,
    	location: csToolsEventDetail.location || data.location || metadata.location || annotation.location
    		|| annotation?.metadata?.location,
    	text: csToolsEventDetail.text || data.text || metadata.text || annotation.text,
      isReadOnly, measurementNumber,
    });

    return {
      uid: annotationUID,
      SOPInstanceUID,
      FrameOfReferenceUID,
      isLocked,
      isVisible,
      metadata,
      referenceSeriesUID: SeriesInstanceUID,
      referenceStudyUID: StudyInstanceUID,
      referencedImageId,
      toolName: metadata.toolName,
      displaySetInstanceUID: displaySet.displaySetInstanceUID,
      label: data.label || csToolsEventDetail.label || annotation.label || csToolsEventDetail.text || data.text,
      data: data,
      type: getValueTypeFromToolType(toolName),
      description: csToolsEventDetail.description || annotation.description || data.description || metadata.description,
      value,
    }; 
	}
}


export default DICOMSRSeriesTagTool;
export { DICOMSRSeriesTagTool, }