import _ from 'lodash';
import dcmjs from 'dcmjs';

import cornerstone from 'cornerstone-core';

import { adaptersSR as c3dAdaptersSR } from '@cornerstonejs/adapters';

import { DicomMetadataStore } from '../../services/DicomMetadataStore';
import { fileLoader } from '../../store';

import Enums from '../../measurements/enums';
import getImagePath from '../../measurements/lib/getImagePath';
import MeasurementApi from '../../measurements/classes/MeasurementApi';

import initDisplaySetMeasurements from '../utils/initDisplaySetMeasurements';
import parseSCOORD3D from './parseSCOORD3D';
import findInstanceMetadataBySopInstanceUID from '../utils/findInstanceMetadataBySopInstanceUid';

const {
  CORNERSTONE_TOOLS_SOURCE_NAME, CORNERSTONE_TOOLS_SOURCE_VERSION, Cornerstone: CornerstoneSR,
} = Enums;


const parseDicomStructuredReport = async (part10SRArrayBuffer, displaySets, external, options) => {
  // Function to parse a DICOM-SR part10a array buffer to measurementData so it can be consumed via
  // the OHIF measurement API. This method utilizes the legacy Cornerstone Tools to parse data to
  // measurement instances via DCM.js Cornerstone Tools adapters and Cornerstone Tools measurement report.  

  // @input part10SRArrayBuffer: array buffer to be parsed and "hydrated" to measurement instances.
  // @input displaySets: array of display sets associated with the part10SRArrayBuffer. 
  // @input external (object): references to external components such as as the services manager.
  // @input options (object): parsing options
  //   - metaData (module, default='@cornerstonejs/core/metaData'): metadata module to be used by the
  //     measurementReport instance for parsing of DICOM-SR metadata.

  options = options || {};

  // Retrieve references to services and API
  const { LoggerService, UINotificationService, displaySetService } = external.servicesManager.services;
  const measurementApi = MeasurementApi.Instance;
  const measurementService = measurementApi.measurementService;

  // Initialize DICOM-SR displaySets for processing
  const { imageDisplaySets, srDisplaySets } = initDisplaySetMeasurements(displaySets, external.servicesManager, {
    module: CornerstoneSR.sr,
  });

  const srMeasurements = {};

  // Retrieve source and source mappings for the DICOM-SR module
  const { source, mappings, mappingDefinitions, } = measurementApi._serviceSourceMappings({
    sourceName: CornerstoneSR.sr.name, sourceVersion: CornerstoneSR.sr.version,
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

  // Rehydrate measurement instances via Cornerstone3D
  let storedMeasurementByAnnotationType = options.parserModule.measurementReport.generateToolState(instanceSR);

  console.log('[DICOM-SR:parseDicomStructuredReport:hydratableMeasurements] measurements retrieved from DICOM-SR by toolType', 
    storedMeasurementByAnnotationType);

  // Filter DICOM-SR file contents to measurements supported by the viewer
  const hydratableMeasurementsInSR = {};

  _.each(_.keys(storedMeasurementByAnnotationType), key => {

    if (mappingDefinitions.includes(key)) {
      hydratableMeasurementsInSR[key] = storedMeasurementByAnnotationType[key];
    }
  });

  let measurementNumber = 1;

  // Generate tool data / annotation structure
  _.each(_.keys(hydratableMeasurementsInSR), annotationType => {

    const toolDataForAnnotationType = hydratableMeasurementsInSR[annotationType];
    srMeasurements[annotationType] = [];

    // Package tool data as anotation data and add to the measurements service.
    _.each(toolDataForAnnotationType, toolData => {
      let annotationData = _.cloneDeep((toolData.annotation || {}).data || toolData);
      const frameNumber = (annotationData && annotationData.frameNumber) || annotationData.frameIndex || toolData.frameIndex || 1;

      let instance, imageId, imagePath, FrameOfReferenceUID, SOPInstanceUID, SeriesInstanceUID, StudyInstanceUID, PatientID;

      // Unpack metadata from OHIF v2 stack/service
      instance = findInstanceMetadataBySopInstanceUID(displaySets, toolData.sopInstanceUid);
      if (instance) {
        const { _study: study, _series: series } = instance;
        ({ StudyInstanceUID, PatientID } = study);
        ({ SeriesInstanceUID } = series);
        SOPInstanceUID = toolData.sopInstanceUid;

        // Retrieve Image ID from path
        imageId = instance.getImageId();
      }

      // Prevent rendering of annotations without a defined imageId
      if (!imageId) {
        return;
      }

      // Creeate image path
      imagePath = getImagePath(StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID, frameNumber);

      // Retrive _id for annotation
      const _id = toolData._id || imageId+measurementNumber;
      
      // Add annotation properties to tool data to preserve compatibility with OHIF v4 MeasurementApi.
      annotationData = _.extend(annotationData, {
        imageId, imagePath, PatientID, StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID,
      });
      annotationData['_id'] = _id;

      // Create annotation metadata structure
      const annotationMeta = {
        toolName: annotationType,
        referencedImageId: imageId,
        FrameOfReferenceUID,
        PatientID,
        StudyInstanceUID,
        SeriesInstanceUID,
        SOPInstanceUID,
        imagePath,
        annotationUID: annotationData.annotationUID || _id,
      }
      _.defaults(annotationMeta, { _id });

      // Pack annotation structure for measurement service
      const annotation = {
        annotationUID: annotationData.annotationUID || annotationMeta._id,
        data: annotationData.data || annotationData,
        metadata: annotationMeta,
      }

      console.log('[DICOM-SR:parseDicomStructuredReport:annotationData]', annotation);

      // Add to srMeasurements to be processed via the rendering source
      console.debug('[DICOM-SR:parseDicomStructuredReport:parser-source] process annotation via render source mapping',
        'annotationType'+annotationType, annotation);
      srMeasurements[annotationType].push(annotation);

      // Incremenet measurement number
      ++measurementNumber;
    });
  });

  return srMeasurements;
}


export default parseDicomStructuredReport;