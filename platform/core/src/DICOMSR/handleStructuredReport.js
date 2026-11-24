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
import { readDicomFile } from '../utils/dicomCharacterSet';
import getXHRRetryRequestHook from '../utils/xhrRetryRequestHook';

import getAllDisplaySets from './Cornerstone3d/utils/getAllDisplaySets';
import parseDicomStructuredReport from './parseDicomStructuredReport';
import parseMeasurementsData from './parseMeasurementsData';
import { confirmReport, currentSession, markReportUnconfirmed } from './utils/srDocument';

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

  // The measurement session this retrieval belongs to; its result is dropped if the session is
  // cleared while the report is fetched or parsed
  const loadSession = currentSession();

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

      // Write-back: if the cache holds the study, cache the fetched SR so the next retrieval is
      // local (same opportunistic pattern as dicomLoaderService._fetchAndRecache). The copy takes
      // the study's state: saved when the study has a saved offline copy, temporary otherwise
      // (imaging-development-env#103).
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
          session: !LocalCacheService.isStudySavedSync?.(_args.studyInstanceUID),
        }).catch(() => {});
      }
    }
  }

  if (loadSession !== currentSession()) {
    console.log('[DICOM-SR:retrieveMeasurementFromSR] measurement session cleared during retrieval, report not loaded');
    return undefined;
  }

  // Parse the array buffer and add to the raw DICOM-SR data as a naturalizedInstance
  if (srDisplaySet && !srDisplaySet.naturalizedSrInstance) {

    // Parse dataset to dict and naturalize
    srDisplaySet.srInstanceDicomData = readDicomFile(part10SRArrayBuffer);
    srDisplaySet.srInstanceDataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(
      srDisplaySet.srInstanceDicomData.dict)

    // Add displaySet to service
    displaySetService.addDisplaySets([srDisplaySet]);
  }

  // Retrieve displaySets from 
  const displaySets = getAllDisplaySets(studies);
  const measurementsData = parseDicomStructuredReport(part10SRArrayBuffer, displaySets, external, { loadSession });

  return measurementsData;
};


// Series-level attributes copied from a stored report into the series entry of the cached study
// metadata payload, which has the shape of a QIDO-RS series result.
const PAYLOAD_SERIES_TAGS = [
  '0020000D', // StudyInstanceUID
  '0020000E', // SeriesInstanceUID
  '00080060', // Modality
  '00200011', // SeriesNumber
  '0008103E', // SeriesDescription
  '00080021', // SeriesDate
  '00080031', // SeriesTime
];

const cacheStoredReport = async (dataset, part10Buffer, instanceJson) => {
  /**
  * Add a report the server has stored to the offline copy of its study, when the study has one.
  * A cached study opens from its stored metadata payload alone, so a report missing from the
  * cache would stay missing from every later open of the study. Whether the study has a copy is
  * left to the cache, which decides under its study lock from the stored index (see
  * LocalCacheService.cacheViewerInstance): this context's membership can be stale, for instance
  * when another tab saved the copy after this one started. A failure is logged and does not fail
  * the save: the report is already on the server.
  *
  * @param {Object} dataset - the report as a naturalized dataset
  * @param {ArrayBuffer} part10Buffer - the report as Part 10 bytes, as uploaded
  * @param {Object} instanceJson - the report as DICOM+JSON (the denaturalized dataset)
  * @returns {Promise<void>}
  */
  const { StudyInstanceUID } = dataset;
  if (!StudyInstanceUID || !LocalCacheService?.cacheViewerInstance) {
    return;
  }

  try {
    const series = {};
    PAYLOAD_SERIES_TAGS.forEach(tag => {
      if (instanceJson[tag]) {
        series[tag] = instanceJson[tag];
      }
    });
    await LocalCacheService.cacheViewerInstance({
      StudyInstanceUID,
      bytes: part10Buffer,
      metadata: dataset,
      instance: instanceJson,
      series,
    });
  } catch (error) {
    console.warn('[DICOM-SR:stowSRFromMeasurements] the stored report was not added to the offline copy of its study', error);
  }
};


const stowSRFromMeasurements = async (measurements, serverUrl, options) => {
  /**
  * Function to store measurements to DICOM Structured Reports in determined server.
  *
  * @param {Object} measurements - OHIF measurementData object
  * @param {string} serverUrl - Server URL to be used on request
  * @returns {Promise<Object>} `{ omitted, saved, written, uploaded, StudyInstanceUID }`: the
  *   measurements left out and stored, whether the report was uploaded, and the stored report's study
  */

  const measurementApi = ohifMeasurements.MeasurementApi.Instance;
  const displaySetApi = display.DisplaySetApi.Instance;

  // Create DICOM-SR document from measurements
  const { dataset, omitted, saved, written } = parseMeasurementsData(measurements, options);

  // Every measurement was left out: nothing to store
  if (saved === 0 && omitted && omitted.length) {
    return { omitted, saved, uploaded: false };
  }

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

  // Shown in the viewer now, stored once the upload succeeds
  markReportUnconfirmed(dataset.SOPInstanceUID);

  // Trigger displaySetApi with DICOM transfer data
  displaySetApi.displaySetService.triggerApiEvent(
    display.Enums.EVENTS.DCM_LOCAL_CREATE, { dcmData: dataset, dcm: part10Buffer });

  const dicomWeb = new api.DICOMwebClient(config);
  await dicomWeb.storeInstances({
    datasets: [part10Buffer],
  });
  confirmReport(dataset.SOPInstanceUID);
  await cacheStoredReport(dataset, part10Buffer, dicomDict.dict);

  // Measurements the report left out, for the save result, the angles it holds, and the study the
  // stored report belongs to, whose cached metadata no longer lists all its series
  return {
    omitted: omitted || [], saved, written: written || [], uploaded: true,
    StudyInstanceUID: dataset.StudyInstanceUID,
  };
};


export { retrieveMeasurementFromSR, stowSRFromMeasurements };
