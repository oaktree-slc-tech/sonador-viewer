import cornerstone from 'cornerstone-core';
import dcmjs from 'dcmjs';

import { utilities as c3dUtils } from '@cornerstonejs/core';
import { adaptersSR as c3dAdaptersSR } from '@cornerstonejs/adapters';

import log from '../log';
import measurements from '../measurements';
import MeasurementReport from './SCOORD3D/MeasurementReport';
import { encodeExtendedMeta } from './utils/dcmsrExtendedMeta';
import { encodeDisplayAttributes } from './utils/dcmsrDisplayAttributes';
import { currentSession, documentSettings, isApplicationMeasurement, saveParent } from './utils/srDocument';
import { propertyParentOf } from './utils/propertyParent';
import { drawnViewOf } from './utils/measurementView';
import { measurementVersion, omittedMeasurement } from './utils/saveResult';
import { isOutOfPlaneMeasurement, patientKeyOf, patientToolData } from './utils/outOfPlane';
import DicomMetadataStore from '../services/DicomMetadataStore';

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
  // The series of the patient-domain measurements, by tool state key
  const patientSeries = {};

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

      // An out-of-plane measurement holds its patient points; it has no image
      if (isOutOfPlaneMeasurement(measurement)) {
        if (isApplicationMeasurement(measurement.metadata.TrackingUniqueIdentifier)) {
          log.info('[DICOM-SR:parseMeasurementsData] measurement of an application document not written',
            measurement.metadata.TrackingUniqueIdentifier);
          return;
        }
        // A held measurement is keyed by itself: its evidence is that of the report it was read from
        const { carriedEvidence } = measurement.metadata;
        const key = patientKeyOf(carriedEvidence ? measurement.uid
          : measurement.metadata.sourceSeries || measurement.referenceSeriesUID);
        patientSeries[key] = patientSeries[key] || seriesEvidence(measurement);
        toolState[key] = toolState[key] || {};
        toolState[key][toolType] = toolState[key][toolType] || { data: [] };
        toolState[key][toolType].data.push(patientToolData(measurement));
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
        
        // Unpack measurement data from the annotation for deyhdration to DICOM-SR
        const { measurementData: annotationData } = MeasurementApi._unpackMeasurementData(annotation);

        // A measurement hydrated from an application document is never written: the save would
        // copy it into another document
        const trackingUID = annotationData && (annotationData.TrackingUniqueIdentifier
          || (annotationData.metadata && annotationData.metadata.TrackingUniqueIdentifier));
        if (isApplicationMeasurement(trackingUID)) {
          log.info('[DICOM-SR:parseMeasurementsData] measurement of an application document not written', trackingUID);
          return;
        }

        // Retrieve references to report data structure, initialize if it does not exist
        toolState[imageId] = toolState[imageId] || {};
        toolState[imageId][toolType] = toolState[imageId][toolType] || { data: [], };
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

  // Document class and root template: the parent's on a re-save (the single SR hydrated for the
  // study), Comprehensive 3D SR with the Sonador template otherwise
  const firstImageId = Object.keys(toolState)[0];
  const generalSeriesModule = firstImageId && (patientSeries[firstImageId]
    ? { studyInstanceUID: patientSeries[firstImageId].StudyInstanceUID }
    : cornerstone.metaData.get('generalSeriesModule', firstImageId));
  const parent = generalSeriesModule ? saveParent(generalSeriesModule.studyInstanceUID) : null;
  const document = {
    ...documentSettings(parent),
    personName: options.observer && options.observer.personName,
  };

  const refused = new Set();
  const omitted = [];
  // The measurements written to the report, as they were written (utils/saveResult.js), by
  // measurement-service uid
  const written = new Map();
  log.info('[DICOM-SR:parseMeasurementsData] annotation data for persistence', toolState,
    'documentClass='+document.documentClass, 'parent='+(parent ? parent.SOPInstanceUID : 'none'));
  const report = MeasurementReport.generateReport(toolState, cornerstone.metaData, _.extend({}, _.pick(options, 'headers'), {
    document,
    patientSeries,
    onMeasurementRefused: (toolType, tool, error) => {
      // Raised once per tool; reported to the user with the save result, after the report is stored
      if (refused.has(tool)) {
        return;
      }
      refused.add(tool);
      const measurement = measurementOf(tool);
      omitted.push(omittedMeasurement(toolType, measurement || tool, error));
      log.warn('[DICOM-SR:parseMeasurementsData] measurement left out of the report toolType='+toolType
        +' reason='+(error.code || 'invalid'), error.message, tool);
    },
    onContentItemCreate: (toolType, measurementIds, tid300Measurement, srItem, encoding) => {

      // Retrieve measurement from API
      const measurement = measurementOf(measurementIds);
      if (measurement && measurement.uid) {
        // A measurement written for the first time (no tracking UID yet) was drawn in this session:
        // it is labelled with the view it was drawn in (Sonador-Measurement.View). One read from a
        // report keeps the views it was read with, and gets none it did not have.
        const firstWrite = !(measurement.metadata && measurement.metadata.TrackingUniqueIdentifier);
        if (firstWrite && !_.size(measurement.metadata && measurement.metadata.views)) {
          const { imageId } = MeasurementApi._getImageIdentifiers(measurement);
          const view = drawnViewOf(toolType, measurement, imageId && cornerstone.metaData.get('imagePlaneModule', imageId));
          if (view) {
            measurement.metadata = { ...(measurement.metadata || {}), views: [view] };
          }
        }

        // The tracking UID the report holds stays with the measurement (dcmjs mints it for a new
        // one): a re-save keeps it, and the report's own load finds the measurement already held.
        // The last build is the one stored. The version is taken with it in place.
        const trackingUID = measurementVersion(measurement, srItem).TrackingUniqueIdentifier;
        if (trackingUID) {
          measurement.metadata = { ...(measurement.metadata || {}), TrackingUniqueIdentifier: trackingUID };
        }
        written.set(measurement.uid, measurementVersion(measurement, srItem, currentSession()));

        // Encoded extended attributes from measurement instance and broadcast via measurement service
        // to allow plugins to modify sequence data.
        const propertyParent = propertyParentOf(toolType);
        encodeExtendedMeta(measurement, srItem, { propertyParent });
        encodeDisplayAttributes(measurement, srItem, { ...encoding, propertyParent });
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

  function measurementOf({ uid, _id }) {
    // The classic record of a tool, or the out-of-plane record (its uid is the tool's)
    const classic = measurementApi.getMeasurementByCornerstoneId(_id);
    if (classic) {
      return classic;
    }
    const record = uid && measurementApi.measurementService.getMeasurement(uid);
    return isOutOfPlaneMeasurement(record) ? record : undefined;
  }

  // Measurements written: every tool of the tool state but those left out
  const saved = _.sum(_.flatMap(_.values(toolState), byType => _.map(byType, ({ data }) => data.length))) - omitted.length;
  return { dataset: report.dataset, omitted, saved, written: [...written.values()] };
};


function seriesEvidence(measurement) {
  // The study, series and instances of the series an out-of-plane measurement was drawn on; for a
  // held one whose series is not loaded, the evidence of the report it was read from
  const { carriedEvidence } = measurement.metadata;
  if (carriedEvidence) {
    return carriedEvidence;
  }
  const StudyInstanceUID = measurement.referenceStudyUID;
  const SeriesInstanceUID = measurement.metadata.sourceSeries || measurement.referenceSeriesUID;
  let series;
  try {
    series = DicomMetadataStore.getSeries(StudyInstanceUID, SeriesInstanceUID);
  } catch (error) {
    series = undefined;
  }
  const instances = ((series && series.instances) || [])
    .filter(instance => instance && instance.SOPInstanceUID)
    .map(instance => _.pick(instance, 'SOPClassUID', 'SOPInstanceUID'));
  if (!instances.length) {
    log.warn('[DICOM-SR:parseMeasurementsData] no instances of the source series for the evidence', SeriesInstanceUID);
  }
  return { StudyInstanceUID, SeriesInstanceUID, instances };
}


export default parseMeasurementsData;
