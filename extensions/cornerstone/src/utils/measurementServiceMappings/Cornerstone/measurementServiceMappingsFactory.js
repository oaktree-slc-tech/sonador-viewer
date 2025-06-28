import _ from 'lodash';

// Legacy Cornerstone Tools
import cornerstone from 'cornerstone-core';
import csTools from 'cornerstone-tools';

import {
  measurementServiceMappingTools,
  commonCleanAnnotation,
  SUPPORTED_TOOLS, 
} from './common.js';
import { Length as LengthMapping } from './Length.js'


const measurementServiceMappingsFactory = (measurementService, measurementSource) => {
  // Create mappings for the measurement service. This method generates the mapping structures
  // and bindings for the Cornerstone v4 (Classic/Legacy) tools used by the Sonador viewer.

  const commonToAnnotation = (measurement, definition) => {
    return measurementServiceMappingTools.commonToAnnotation(measurementService, measurement, definition);
  }

  const commonToMeasurement = csToolsAnnotation => {
    return measurementServiceMappingTools.commonToMeasurement(measurementService, csToolsAnnotation);
  }

  const factories = {
    
    Length: _.extend(_.pick(LengthMapping, 'toolName', 'cleanAnnotation'), {
      toAnnotation: (measurement, definition) => {
        return LengthMapping.toAnnotation(measurementService, measurement, definition);
      },
      toMeasurement: (csToolsAnnotation) => {
        return LengthMapping.toMeasurement(measurementService, csToolsAnnotation);
      },
      toAltSourceMeasurementSchema: (dstSrc, measurement, src) => {
        return LengthMapping.toAltSourceMeasurementSchema(measurementService, dstSrc, measurement, src);
      },
      matchingCriteria: {
        valueType: measurementService.VALUE_TYPES.POLYLINE,
        points: 2,
      }
    }),
    ArrowAnnotateTool: {
      toolName: 'ArrowAnnotate',
      toAnnotation: commonToAnnotation,
      toMeasurement: commonToMeasurement,
      cleanAnnotation: commonCleanAnnotation,
      matchingCriteria: {
        valueType: measurementService.VALUE_TYPES.POINT,
        points: 1,
      }
    },

    onElementEnabled: (event) => {
      // Initialize measurement service event handlers
      // 1. MEASUREMENT_ADDED
      // 2. MEASUREMENT_UPDATED
      // 3. RAW_MEASUREMENT_ADDED

      // Unpack source ID and callback methods
      const { uid: sourceId, annotationToMeasurement, getAnnotation, remove } = measurementSource;
      const { MEASUREMENT_ADDED, MEASUREMENT_UPDATED, RAW_MEASUREMENT_ADDED } = measurementService.EVENTS;

      const addOrUpdateMeasurement = (csToolsAnnotation) => {
        // Add the measurement to the service or update the value if it already exists.
        // Legacy mappings utilize the measurement service for storing all annotation data.

        console.debug('[cornerstone:measurement:event:add/update] annotation', csToolsAnnotation);

        try {

          // Unpack measurement metadata from Cornerstone Tools and OHIF UI
          const { toolName, toolType, measurementData } = csToolsAnnotation;
          const csTool = toolName || measurementData.toolType || toolType;
          csToolsAnnotation.uid = measurementData._measurementServiceId;

          // Send data to measurement service
          const isUpdate = !_.isUndefined(csToolsAnnotation.uid);
          const measurementServiceId = annotationToMeasurement(
            csTool, csToolsAnnotation, Boolean(csToolsAnnotation.uid));

          // Add measurement UID (provided by measurement service) to the annotation for
          // tracking state and persistence.
          if (!measurementData._measurementServiceId) {
            addMeasurementServiceId(csTool, measurementServiceId, csToolsAnnotation);
          }
        } catch (error) {
          console.warn('Failed to add or update measurement:', error);
        }
      };

      const addMeasurementServiceId = (csTool, uid, csToolsAnnotation) => {
        // Add measurement service UID to the annotation

        // Add measurement data to the annotation payload and to the measurement data
        // as _measurementServiceId to retain compatability with Cornerstone Tools (Classic/Legacy)
        csToolsAnnotation.uid = uid;
        const { measurementData } = csToolsAnnotation;
        Object.assign(measurementData, { _measurementServiceId: uid });

        // Ensure that there is an _id attribute and that it is attached to the annotation
        const annotationMeta = csToolsAnnotation.metadata || measurementData.metadata || csToolsAnnotation;        
        const _id = measurementData._id || csToolsAnnotation._id || annotationMeta._id;

        // Attach service uid _id to the annotation
        if (!_id) {
          csToolsAnnotation._id = uid;
        }
        if (!measurementData._id) {
          csToolsAnnotation.measurementData._id = csToolsAnnotation._id;
        }
        if (!csToolsAnnotation.metadata || !csToolsAnnotation.metadata?._id) {
          if (_.isUndefined(csToolsAnnotation.metadata)) csToolsAnnotation.metadata = {};

          csToolsAnnotation.metadata._id = csToolsAnnotation._id;
        }

        // Update the measurement so that the UID is added to the meta and measurement data
        annotationToMeasurement(csTool, csToolsAnnotation, true);
      };


      [csTools.EVENTS.MEASUREMENT_ADDED, csTools.EVENTS.MEASUREMENT_MODIFIED].forEach((csToolsEvtName) => {
        event.detail.element.addEventListener(csToolsEvtName, ({ detail: csToolsAnnotation }) => {
          addOrUpdateMeasurement(csToolsAnnotation);
        });
      });
    }
  }

  return factories;
};


export default measurementServiceMappingsFactory;
export { measurementServiceMappingsFactory };