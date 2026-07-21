import _ from 'lodash';

import dcmjs from 'dcmjs';
import { api } from 'dicomweb-client';

import DicomMetadataStore from '../services/DicomMetadataStore';
import utils from '../utils';
import ohifMeasurements from '../measurements';
import display from '../display';

import DICOMWeb from '../DICOMWeb';
import errorHandler from '../errorHandler';
import LocalCacheService from '../services/LocalCacheService/LocalCacheService';
import { isUsablePart10 } from '../utils/dicomPart10';
import getXHRRetryRequestHook from '../utils/xhrRetryRequestHook';

import getAllDisplaySets from './Cornerstone3d/utils/getAllDisplaySets';
import parseDicomStructuredReport from './parseDicomStructuredReport';
import parseMeasurementsData from './parseMeasurementsData';

const VERSION_NAME = 'dcmjs-0.0';
const TRANSFER_SYNTAX_UID = '1.2.840.10008.1.2.1';


const retrieveMeasurementFromSR = async (series, studies, serverUrl, external) => {
  /**
  * Function to retrieve measurements from DICOM Structured Reports coming from determined server.
  * Data is parsed to measurement instances using the configured MeasurementService.
  * Refer to Sonador / OHIF documentation for additional detail.
  *
  * @param {Array} series - List of all series metaData loaded
  * @param {Array} studies - List of all studies metaData loaded
  * @param {string} serverUrl - Server URL to be used on request
  * @param {object} external
  * 
  * @returns {Object} MeasurementData: OHIF measurement schema parsed from DICOM-SR
  *   via the OHIF MeasurementService. Data is encoded as arrays of measurement instances
  *   keyed to their tool/annotation type. Example:
  *   {
  *     Length: [ ... ],
  *   }
  */
  const { displaySetService } = external.servicesManager.services;

  // Retrieve DICOM-SR data from DICOMweb server
  const config = {
    url: serverUrl,
    headers: DICOMWeb.getAuthorizationHeader(),
    errorInterceptor: errorHandler.getHTTPErrorHandler(),
    requestHooks: [getXHRRetryRequestHook()],
  };

  const dicomWeb = new api.DICOMwebClient(config);
  const instance = series.getFirstInstance();
  
  // Back-fill _imageId if it's not already set on the instance. Fixes an issue where cached instances
  // do not correctly have their imageId set.
  const imageId = utils.getImageId(instance);
  if (!instance._imageId && imageId) {
    
    instance._imageId = imageId;
  }

  // Retrieve metadat from DicomMetadataStore (provides most complete record of instance meta)
  const dcm = DicomMetadataStore.getInstanceByImageId(imageId);

  // Retrieve DICOM array buffer
  const srDisplaySet = _.chain(
    displaySetService.getDisplaySetsForSeries(series.SeriesInstanceUID || series.seriesInstanceUID)).first().value();

  let part10SRArrayBuffer;
  if (srDisplaySet && srDisplaySet.cachePart10SRArrayBuffer) {

    // Used cached DICOM file attached to displaySet instance
    part10SRArrayBuffer = srDisplaySet.cachePart10SRArrayBuffer;
    console.log('[DICOM-SR:retrieveMeasurementFromSR] use cached DCM-SR data for SeriesInstanceUID='
      +(series.SeriesInstanceUID || series.seriesInstanceUID)+' displaySetInstanceUID='+srDisplaySet.displaySetInstanceUID);

  } else {

    // Unpack metadata for retrieving data via DICOMweb client: default to DCM meta from DicomMetadataStore
    // which is compatible with Cornerstone3D and fallback to Cornerstone Classic in the case the meta cannot
    // be retrieved.
    let _args;
    if (dcm) {
      _args = {
        studyInstanceUID: dcm.StudyInstanceUID,
        seriesInstanceUID: dcm.SeriesInstanceUID,
        sopInstanceUID: dcm.SOPInstanceUID,
      }
    } else {
      _args = {
        studyInstanceUID: instance.getStudyInstanceUID(),
        seriesInstanceUID: instance.getSeriesInstanceUID(),
        sopInstanceUID: instance.getSOPInstanceUID(),
      };
    }

    // Offline cache first (ohif-viewers#125): SR instances are cached like any other instance,
    // so measurement retrieval must not hit the network for offline-saved studies.
    if (LocalCacheService?.isInstanceCachedSync(_args.sopInstanceUID)) {
      const cachedBytes = await LocalCacheService.getInstanceBytes(_args.sopInstanceUID);
      if (cachedBytes && isUsablePart10(cachedBytes)) {
        part10SRArrayBuffer = cachedBytes;
      }
    }

    if (!part10SRArrayBuffer) {
      part10SRArrayBuffer = await dicomWeb.retrieveInstance(_args);

      // Write-back: if the study is saved offline, cache the fetched SR so the next retrieval is
      // local (same opportunistic pattern as dicomLoaderService._fetchAndRecache).
      if (
        part10SRArrayBuffer && isUsablePart10(part10SRArrayBuffer) &&
        LocalCacheService?.isStudyCachedSync(_args.studyInstanceUID)
      ) {
        LocalCacheService.putInstance({
          StudyInstanceUID: _args.studyInstanceUID,
          SeriesInstanceUID: _args.seriesInstanceUID,
          SOPInstanceUID: _args.sopInstanceUID,
          bytes: part10SRArrayBuffer,
          metadata: { SOPInstanceUID: _args.sopInstanceUID, Modality: 'SR' },
        }).catch(() => {});
      }
    }
  }

  // Parse the array buffer and add to the raw DICOM-SR data as a naturalizedInstance
  if (srDisplaySet && !srDisplaySet.naturalizedSrInstance) {

    // Parse dataset to dict and naturalize
    srDisplaySet.srInstanceDicomData = dcmjs.data.DicomMessage.readFile(part10SRArrayBuffer);
    srDisplaySet.srInstanceDataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(
      srDisplaySet.srInstanceDicomData.dict)

    // Add displaySet to service
    displaySetService.addDisplaySets([srDisplaySet]);
  }

  // Retrieve displaySets from 
  const displaySets = getAllDisplaySets(studies);
  const measurementsData = parseDicomStructuredReport(part10SRArrayBuffer, displaySets, external);

  return measurementsData;
};


const stowSRFromMeasurements = async (measurements, serverUrl, options) => {
  /**
  * Function to store measurements to DICOM Structured Reports in determined server.
  *
  * @param {Object} measurements - OHIF measurementData object
  * @param {string} serverUrl - Server URL to be used on request
  * @returns {Promise}
  */

  const measurementApi = ohifMeasurements.MeasurementApi.Instance;
  const displaySetApi = display.DisplaySetApi.Instance;

  // Create DICOM-SR document from measurements
  const { dataset } = parseMeasurementsData(measurements, options);
  const { DicomMetaDictionary, DicomDict } = dcmjs.data;
  const meta = {
    FileMetaInformationVersion: dataset._meta.FileMetaInformationVersion.Value,
    MediaStorageSOPClassUID: dataset.SOPClassUID,
    MediaStorageSOPInstanceUID: dataset.SOPInstanceUID,
    TransferSyntaxUID: TRANSFER_SYNTAX_UID,
    ImplementationClassUID: DicomMetaDictionary.uid(),
    ImplementationVersionName: VERSION_NAME,
  };

  const denaturalized = DicomMetaDictionary.denaturalizeDataset(meta);
  const dicomDict = new DicomDict(denaturalized);

  // Create part10 DICOM buffer
  dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);

  const part10Buffer = dicomDict.write();

  const config = {
    url: serverUrl,
    headers: DICOMWeb.getAuthorizationHeader(),
    errorInterceptor: errorHandler.getHTTPErrorHandler(),
    requestHooks: [getXHRRetryRequestHook()],
  };

  // Trigger displaySetApi with DICOM transfer data
  displaySetApi.displaySetService.triggerApiEvent(
    display.Enums.EVENTS.DCM_LOCAL_CREATE, { dcmData: dataset, dcm: part10Buffer });

  const dicomWeb = new api.DICOMwebClient(config);
  await dicomWeb.storeInstances({
    datasets: [part10Buffer],
  });
};


export { retrieveMeasurementFromSR, stowSRFromMeasurements };
