import _ from 'lodash';

import OHIF from '@ohif/core';
const { log } = OHIF;

import {
  measurementServiceMappingTools,
  commonToAnnotation,
  commonToMeasurement,
  commonCleanAnnotation,
  commonToAltSourceMeasurementSchema,
  SUPPORTED_TOOLS, 
} from './common.js';


const Length = {
  toolName: 'Length',

  toAnnotation: (measurementService, measurement, definition) => {
    // Map measurement format to Cornerstone Tools (Legacy/Classic) v4 format
    log.debug('[cornerstone:measurement:Length:toAnnotation] input measurement', measurement);

    // Retrieve common annotation structure
    const annotation = commonToAnnotation(measurementService, measurement, definition);

    // Ensure that all length annotation components are complete. Copy keys from the measurement
    // to the annotation to ensure that attributes are not dropped.
    const measurementData = measurement.data || measurement;
    const annotationData = annotation.measurementData || annotation.data || annotation;
    _.defaults(annotationData, {
      length: measurement.length || measurementData.length || annotation.length,
    });

    // Length handles
    if (_.keys(measurementData.handles) != _.keys(annotationData.handles)) {

      // _.defaults only copies keys which are not present already
      annotationData.handles = _.defaults((annotationData.handles || {}), measurementData.handles);
    }

    // Ensure that handles is available at the root of the annotation and within annotationData
    if (!annotation.handles && annotationData.handles) {
      annotation.handles = annotationData.handles;
    }

    if (!annotationData.handles && annotation.handles) {
      annotationData.handles = annotation.handles;
    }

    // Ensure that length is available at the root of the annotation and within annotationData
    if (!annotation.length && annotationData.length) {
      annotation.length = annotationData.length;
    }

    if (!annotationData.length && annotation.length) {
      annotationData.length = annotation.length;
    }

    log.debug('[cornerstone:measurement:Length:toAnnotation] output annotation', annotation);
    return annotation
  },

  toMeasurement: (measurementService, csToolsAnnotation) => {
    // Map Cornerstone Tools (Legacy/Classic) to OHIF v3 Measurement Schema    
    const measurement = commonToMeasurement(measurementService, csToolsAnnotation);

    // Ensure that the length property is set on the measurement
    if (!measurement.length && measurement.data?.length) {
      measurement.length = measurement.data.length;
    }
    
    return measurement;
  },
  
  toAltSourceMeasurementSchema: (measurementService, dstSrc, measurement, src) => {
    // Convert the provided measurement instance to the schema of the provided source

    // Convert common properties to the destination 
    let newMeasuremnt =  commonToAltSourceMeasurementSchema(measurementService, dstSrc, measurement, src);
    if (!newMeasuremnt) {
      log.warn('[cornerstone:measurement:Length:toMeasurement] unable to convert measurement');
      return null;
    }

    // Create data hash if one does not exist
    if (!newMeasuremnt.data) {
      newMeasuremnt.data = {};
    }

    // Ensure that textBox data has been copied to the data handles attribute
    if (!newMeasuremnt.data.handles && newMeasuremnt.textBox) {
      newMeasuremnt.data.handles = { textBox: newMeasuremnt.textBox };
    }

    // Copy length attribute to the top of the measurement
    if (_.isNil(newMeasuremnt.length)) {
      newMeasuremnt.length = newMeasuremnt.data['imageId:'+newMeasuremnt.referencedImageId]?.length;
    }

    // Return new measurement instance if all of the components are complete
    return newMeasuremnt.points && newMeasuremnt.length && newMeasuremnt.data.handles ? _.omit(newMeasuremnt, 'textBox') : null;
  },

  cleanAnnotation: commonCleanAnnotation,
}


export default Length;
export { Length, }