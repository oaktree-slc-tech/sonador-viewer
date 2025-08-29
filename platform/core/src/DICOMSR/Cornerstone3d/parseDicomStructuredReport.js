import _ from 'lodash';
import dcmjs from 'dcmjs';

import {
  utilities as c3dCoreUtilities, 
  metaData as c3dCoreMetaData
} from '@cornerstonejs/core';
import { adaptersSR as c3dAdaptersSR } from '@cornerstonejs/adapters';

import { DicomMetadataStore } from '../../services/DicomMetadataStore';
import { fileLoader } from '../../store';

import { dataProc } from '../../utils';

import Enums from '../../measurements/enums';
import MeasurementApi from '../../measurements/classes/MeasurementApi';
import getImagePath from '../../measurements/lib/getImagePath';

import initDisplaySetMeasurements from '../utils/initDisplaySetMeasurements';
import { parseExtendedMeta } from '../utils/dcmsrExtendedMeta';

const {
  CORNERSTONE_3D_TOOLS_SOURCE_NAME, CORNERSTONE_3D_TOOLS_SOURCE_VERSION, Cornerstone3D: Cornerstone3dSR,
} = Enums;


const parseDicomStructuredReport = async (part10SRArrayBuffer, displaySets, external, options) => {
  // Function to parse a DICOM-SR part10a array buffer to measurementData so it can be consumed via
  // the OHIF measurement service. This method utilize Cornerstone3D to parse data to OHIF v3 compatible
  // measurement instances via DCM.js Cornerstone 3D adapters and Cornerstone 3D measurement report.
  // All data exchange, internal registration, and conversion works via the measurement service.

  // The method checks the trackingUid values of the measurement instances and will skip the hydration
  // of instances that are registered with the MeasurementApi.

  // @input part10SRArrayBuffer: array buffer to be parsed and "hydrated" to measurement instances.
  // @input displaySets: array of display sets associated with the part10SRArrayBuffer. 
  // @input external (object): references to external components such as as the services manager.
  // @input options (object): parsing options
  //   - metaData (module, default='@cornerstonejs/core/metaData'): metadata module to be used by the
  //     measurementReport instance for parsing of DICOM-SR metadata.

  options = options || {};
  _.defaults(options, {
    metaData: c3dCoreMetaData,
  });

  // Retrieve references to services and API
  const { LoggerService, UINotificationService, displaySetService } = external.servicesManager.services;
  const measurementApi = MeasurementApi.Instance;
  const measurementService = measurementApi.measurementService;

  if (!displaySetService || !measurementService) {
    throw new Error('Unable to initialize measurements, invalid displaySet or measurementService instance');
  }

  // Initialize DICOM-SR displaySets for processing
  const { imageDisplaySets, srDisplaySets } = initDisplaySetMeasurements(displaySets, external.servicesManager, {
    module: Cornerstone3dSR.sr,
  });

  // Retrieve source and source mappings to ensure that configuration is present
  const {  source, mappings, mappingDefinitions } = measurementApi._serviceSourceMappings({
    sourceName: Cornerstone3dSR.sr.name, sourceVersion: Cornerstone3dSR.sr.version,
  });

  if (!mappings || !mappings.length) {
    throw new Error('Attempting to initialize measurements service when no mappings are present. Invalid configuration.');
  }

  // Import data to the DicomMetadataStore
  const dcm = await fileLoader.Local.fileToStudy(part10SRArrayBuffer);
  if (!dcm) {
    throw new Error('Unable to parse provided DICOM data. Invalid byte-stream or file.');
  }

  // Retrieve instance for DICOM-SR parsing
  const instanceSR = DicomMetadataStore.getInstance(
    dcm.StudyInstanceUID, dcm.SeriesInstanceUID, dcm.SOPInstanceUID);
  if (!instanceSR) {
    throw new Error('Unable to load DICOM-SR, no instance available in DicomMetadataStore or '
      + 'matching instance not registered with displaySets');
  };

  const sopInstanceUIDToImageId = {};
  const imageIdsForToolState = {};

  displaySets.forEach((ds) => {

    // Retrieve measurements for the displaySet if they have not already been generated.
    const _ds = displaySetService.getDisplaySetByUID(ds.displaySetInstanceUID);
    if (!_ds) {
      log.warn('[DICOM-SR:parseDicomStructuredReport:prepareMeasurementParsing] invalid display set',
        'displaySet for displaySetInstanceUID='+ds.displaySetInstanceUID+' does not exist.', _ds);
      return;
    }

    // Aggregate measurement UIDs and references from displaySets
    _.each(_ds.measurements, m => {
      
      const { ReferencedSOPInstanceUID, imageId, frameNumber } = m;

      if (!sopInstanceUIDToImageId[ReferencedSOPInstanceUID]) {
        console.log('[DICOM-SR:parseDicomStructuredReport:sopInstanceUIDs]', ReferencedSOPInstanceUID, imageId, m);

        sopInstanceUIDToImageId[ReferencedSOPInstanceUID] = imageId;
        imageIdsForToolState[ReferencedSOPInstanceUID] = [];
      }
      if (!imageIdsForToolState[ReferencedSOPInstanceUID][frameNumber]) {
        imageIdsForToolState[ReferencedSOPInstanceUID][frameNumber] = imageId;
      }
    });
  });

  // Rehydrate measurement instances via Cornerstone3D
  let storedMeasurementByAnnotationType = Cornerstone3dSR.sr.measurementReport.generateToolState(
    instanceSR, sopInstanceUIDToImageId, options.metaData, undefined, {
      onContentItemParse: (toolType, annotation, srItem) => { parseExtendedMeta(srItem, annotation); },
    });

  console.log('[DICOM-SR:parseDicomStructuredReport:hydratableMeasurements] measurements retrieved from DICOM-SR by toolType', 
    storedMeasurementByAnnotationType)

  // Filter DICOM-SR file contents to measurements supported by the viewer
  const hydratableMeasurementsInSR = {};

  _.each(_.keys(storedMeasurementByAnnotationType), key => {

    if (mappingDefinitions.includes(key)) {
      hydratableMeasurementsInSR[key] = storedMeasurementByAnnotationType[key];
    }
  });

  // TODO / OHIF v3 Compatibility: Set the series as tracked and aggregate the referenced image IDs 
  // so that measurements can be linked and rendered correctly. The OHIF v2 code does not utilize 
  // the Cornerstone 3D cache and as a result, does not leverage this information directly. It is 
  // collected here to maintain compatibility with OHIF v3.
  const imageIds = [];

  _.each(_.keys(hydratableMeasurementsInSR), annotationType => {
    const toolDataForAnnotationType = hydratableMeasurementsInSR[annotationType];

    // Retrieve data to construct toolState and build image ID references. DCM.js and Cornerstone3D 
    // has a structural defect in supporting multi-frame files, and looking up the ImageID via 
    // sopInstanceUIDToImageId may result in the wrong value.
    _.each(toolDataForAnnotationType, toolData => {

      // Look through tool/annotation data for linked reference images
      const annotationData = _.cloneDeep((toolData.annotation || {}).data || toolData);
      const frameNumber = (annotationData && annotationData.frameNumber) || annotationData.frameIndex || 1;

      if (imageIdsForToolState[toolData.sopInstanceUid] || sopInstanceUIDToImageId[toolData.sopInstanceUid]) {
        const imageId = imageIdsForToolState[toolData.sopInstanceUid][frameNumber] 
          || sopInstanceUIDToImageId[toolData.sopInstanceUid];

        if (!imageIds.includes(imageId)) {
          imageIds.push(imageId);
        }
      }
    });
  });

  // OHIF v3 Compatibility: Collect Study instance and series instance UIDs via target references.
  let targetStudyInstanceUID;
  const SeriesInstanceUIDs = [];

  for (let i = 0; i < imageIds.length; i++) {
    const imageId = imageIds[i];
    const instance = options.metaData.get('instance', imageId);

    // Unpack instance data from metadata service
    if (instance) {
      const { SeriesInstanceUID, StudyInstanceUID } = instance;

      if (SeriesInstanceUID && !SeriesInstanceUIDs.includes(SeriesInstanceUID)) {
        SeriesInstanceUIDs.push(SeriesInstanceUID);
      }

      if (!targetStudyInstanceUID) {
        targetStudyInstanceUID = StudyInstanceUID;
      } else if (targetStudyInstanceUID !== StudyInstanceUID) {
        console.warn('NO SUPPORT FOR SRs THAT HAVE MEASUREMENTS FROM MULTIPLE STUDIES.');
      }
    }
  }

  let measurementNumber = 1;

  // Generate tool data / annotation structure
  _.each(_.keys(hydratableMeasurementsInSR), annotationType => {

    const toolDataForAnnotationType = hydratableMeasurementsInSR[annotationType];

    // Package tool data as anotation data and add to the measurements service.
    _.each(toolDataForAnnotationType, toolData => {
      let annotationData = _.cloneDeep((toolData.annotation || {}).data || toolData);
      let _annotationMeta = _.cloneDeep(toolData.annotation?.metadata || {});
      const frameNumber = (annotationData && annotationData.frameNumber) || annotationData.frameIndex || toolData.frameIndex || 1;

      let instance, imageId, imagePath, FrameOfReferenceUID, SOPInstanceUID, SeriesInstanceUID, StudyInstanceUID, PatientID;
      if (imageIdsForToolState[toolData.sopInstanceUid] || sopInstanceUIDToImageId[toolData.sopInstanceUid]) {

        // Attempt to retrieve cached instance from Cornerstone 3D meta service with fallback to OHIF v2 meta
        // if not available. (Refer to below.)
        imageId = imageIdsForToolState[toolData.sopInstanceUid][frameNumber] || sopInstanceUIDToImageId[toolData.sopInstanceUid];
        if (imageId) {
          instance = cornerstone.metaData.get('instance', imageId);
          console.debug('[DICOM-SR:parseDicomStructuredReport:retrieveImageMeta] instance data retrieved from Cornerstone meta provider for imageId=', instance);

          // Unpack metadata from Cornerstone 3D metadata service
          if (instance) {
            ({
              FrameOfReferenceUID,
              SOPInstanceUID,
              SeriesInstanceUID,
              StudyInstanceUID,
              PatientID,
            } = instance);
          }
        }
      }

      // Prevent rendering of annotations without a defined imageId
      if (!imageId) {
        return;
      }

      // Retrieve unique tracking identifier: used to detect duplicates within the measurement service
      const trackingUid = toolData.TrackingUniqueIdentifier || annotationData.TrackingUniqueIdentifier 
        || toolData.annotation?.metadata?.TrackingUniqueIdentifier;

      // Create image path
      imagePath = getImagePath(StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID, frameNumber);

      // Retrive _id for annotation
      const _id = toolData._id || imageId+measurementNumber;
      
      // Add annotation properties to tool data to preserve compatibility with OHIF v4 MeasurementApi.
      annotationData = _.extend(annotationData, {
        imageId, imagePath, PatientID, StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID,
      });
      annotationData['_id'] = _id;

      // Create annotation metadata structure
      const annotationMeta = _.extend(_annotationMeta, {
        toolName: annotationType,
        referencedImageId: imageId,
        FrameOfReferenceUID,
        PatientID,
        StudyInstanceUID,
        SeriesInstanceUID,
        SOPInstanceUID,
        imagePath,
        annotationUID: annotationData.annotationUID || _id,
        location: annotationData.metadata?.location || toolData.annotation.metadata?.location,        
      });
      _.defaults(annotationMeta, { _id, TrackingUniqueIdentifier: trackingUid });
      _.defaults(annotationMeta, _.pick(toolData, 'TrackingUniqueIdentifier', 'description', 'finding', 'findingSites'));

      // Pack annotation structure for measurement service
      const annotation = {
        annotationUID: annotationData.annotationUID || annotationMeta._id,
        data: annotationData.data || annotationData,
        metadata: annotationMeta,
      }

      console.debug('[DICOM-SR:parseDicomStructuredReport:annotationData] trackingUid='+trackingUid+' toolType='+annotationType, annotation);

      // For parser defined mappings, add annotation to measurement service. For annotations not
      // defined via the parser, return with the srMeasurements result to be processed by the
      // render source/mappings.
      const {
        toolServiceManaged: parserToolServiceManaged, source: parserSource
      } = measurementApi._serviceManagedTool(annotationType, {
        sourceName: Cornerstone3dSR.sr.name, sourceVersion: Cornerstone3dSR.sr.version,
      });

      // Check if the measurement has already been imported to the UID
      const _apiMeasurement = measurementApi.getMeasurementByTrackingUid(trackingUid)

      if (parserToolServiceManaged && !_apiMeasurement) {

        console.debug('[DICOM-SR:parseDicomStructuredReport:parser-source] process annotation via parser source mapping',
          'annotationType='+annotationType, annotation);

        if (!measurementApi._apiSourceServiceMeasurement(annotation, parserSource)) {
          
          // For measurements which are added via a source different than that being used
          // by the measurementApi, they will need to be converted to a schema compatible with the 
          // viewer before they can be rendered.
          annotation.metadata.createRenderVersion = true;
        }

        // Create measurement via the parser source and trigger EVENTS.MEASUREMENT_ADDED
        const measurement_uid = parserSource.annotationToMeasurement(annotationType, { annotation, });
        const measurement = measurementService.getMeasurement(measurement_uid);
        measurementService._broadcastEvent(measurementService.EVENTS.MEASUREMENT_ADDED, {
          source: parserSource, measurement, data: annotation,
        });

        console.log('[DICOM-SR:parseDicomStructuredReport:parser-source] import measurement to service',
          'annotationType='+annotationType, 'uid='+measurement_uid, measurement)

      } else if (_apiMeasurement) {

        // Measurement already imported to measurement service
        log.info('[DICOM-SR:parseDicomStructuredReport:duplicate] duplicate measurement,'
          +' skip import: annotationType='+annotationType, annotation);
        return;

      } else {

        // Measurement not managed via measurement service, skip import of annotation data
        log.warn('[DICOM-SR:parseDicomStructuredReport:invalid-tool] unable to import via measurement service '
          +'annotationType='+annotationType, annotation);
        return;

      }

      // Incremenet measurement number
      ++measurementNumber;
    });
  });
}


export default parseDicomStructuredReport;