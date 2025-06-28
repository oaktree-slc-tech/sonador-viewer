import cornerstone from 'cornerstone-core';
import dcmjs from 'dcmjs';

import { utilities as c3dUtils } from '@cornerstonejs/core';
import { adaptersSR as c3dAdaptersSR } from '@cornerstonejs/adapters';

import log from '../log';
import measurements from '../measurements';
import MeasurementReport from './SCOORD3D/MeasurementReport';
import { encodeExtendedMeta } from './utils/dcmsrExtendedMeta';

const { getImageIdForImagePath, MeasurementApi } = measurements;

import isToolSupported from './utils/isToolSupported';


const parseMeasurementsData = (measurementsData, options) => {
  /**
  * Function to parse OHIF viewer measurementData into a DCM.js DICOM-SR MeasurementReport
  *
  * @param {Object} measurementsData - OHIF measurementData object
  * @input options (object): options for manging the conversion of the measurement data to DICOM-SR
  
  * @returns {Object} Dataset: measurement report from dcmjs
  */
  options = options || {};

  // Add default DICOM headers
  _.defaults(options, { headers: {} });
  _.defaults(options.headsers, {
    SeriesDescription: measurements.Enums.DCM.SONADOR_MEAUSREMENT_REPORT_SERIES_DESCRIPTION,
    Manufacturer: measurements.Enums.SONADOR_PROJECT,
    ManufactuerModelName: measurements.Enums.SONADOR_VIEWER,
    DeviceSerialNumber: measurements.Enums.DCM.SONADOR_DCMSR_DEVICE_NUMBER,
    ContentQualification: measurements.Enums.DCM.SONADOR_DCMSR_CONTENT_QUALIFICATION,
  });

  // Retrieve measurement API instance
  const measurementApi = measurements.MeasurementApi.Instance;

  const toolState = {};
  const unsupportedTools = [];

  Object.keys(measurementsData).forEach((measurementType) => {
    const measurements = measurementsData[measurementType];

    measurements.forEach((measurement) => {

      // Retrieve annotation
      const toolType = MeasurementApi._getToolType(measurement);
      const { uid, _id } = MeasurementApi._unpackMeasurementData(measurement);

      if (!uid) {
        log.warn('[DICOM-SR:parseMeasurementsData] unable to persist measurement, invalid UID', measurement);
        return;
      }

      const { source, toolServiceManaged, toolMapping } = measurementApi._serviceManagedTool(toolType);
      if (!toolServiceManaged) {
        log.warn('[DICOM-SR:parseMeasurementsData] unbale to retrieve annotation for measurement toolType='+toolType,
          'Measurement is not managed by the measuremetn service.');
        return;
      }

      // Retrieve annotation from the 
      const annotation = source.getAnnotation(toolType, uid);
      const { imageId, imagePath } = MeasurementApi._getImageIdentifiers(measurement);

      if (!imageId) {
        log.warn('[DICOM-SR:parseMeasurementsData] unable to persist annotation, invalid imageId', measurement);
        return;
      }

      if (isToolSupported(toolType) && toolServiceManaged) {
        
        // Retrieve references to report data structure, initialize if it does not exist
        toolState[imageId] = toolState[imageId] || {};
        toolState[imageId][toolType] = toolState[imageId][toolType] || { data: [], };

        // Unpack measurement data from the annotation and add it to the toolState array for deyhdration to DICOM-SR.
        const { measurementData: annotationData } = MeasurementApi._unpackMeasurementData(annotation);
        toolState[imageId][toolType].data.push(annotationData);

      } else {
        unsupportedTools.push(toolType);
      }
    });
  });

  if (unsupportedTools.length > 0) {
    log.warn(`[DICOM-SR:parseMeasurementsData] Unsupported tools found in measurement data: ${unsupportedTools.join(', ')}`);
  }

  // Broadcast start of DCM-SR encoding with tool state data
  measurementApi.measurementService._broadcastEvent(measurementApi.measurementService.EVENTS.MEASUREMENTS_DATASYNC, {
    apiEvent: measurements.Enums.EVENTS.MEASUREMENT_DCMSR_ENCODE_START, toolState,
  });

  log.info('[DICOM-SR:parseMeasurementsData] annotation data for persistence', toolState);
  const report = MeasurementReport.generateReport(toolState, cornerstone.metaData, _.extend({}, _.pick(options, 'headers'), {
    onContentItemCreate: (toolType, measurementIds, tid300Measurement, srItem) => {

      // Retrieve measurement from API
      const { _id: cornerstoneId } = measurementIds;
      const measurement = measurementApi.getMeasurementByCornerstoneId(cornerstoneId);
      if (measurement && measurement.uid) {

        // Encoded extended attributes from measurement instance and broadcast via measurement service
        // to allow plugins to modify sequence data.
        encodeExtendedMeta(measurement, srItem);
        measurementApi.measurementService._broadcastEvent(measurementApi.measurementService.EVENTS.MEASUREMENTS_DATASYNC, {
          apiEvent: measurements.Enums.EVENTS.MEASUREMENT_DCMSR_ENCODE_MEASUREMENT, measurement, srItem,
        });
      }
    }
  }));
  _.extend(report.dataset, options.headers);

  // Broadcast DCM-SR encoding success with report instance
  measurementApi.measurementService._broadcastEvent(measurementApi.measurementService.EVENTS.MEASUREMENTS_DATASYNC, {
    apiEvent: measurements.Enums.EVENTS.MEASUREMENT_DCMSR_ENCODE_SUCCESS, dcm: report,
  });

  return { dataset: report.dataset, };
};


export default parseMeasurementsData;
