import log from '../log';
import studies from '../studies';
import utils from '../utils';
import ohifDisplay from '../display';

import findMostRecentStructuredReport from './Cornerstone3d/utils/findMostRecentStructuredReport';
import findStructuredReports from './Cornerstone3d/utils/findStructuredReports';
import { retrieveMeasurementFromSR, stowSRFromMeasurements } from './handleStructuredReport';


const retrieveMeasurements = async (server, external = {}) => {
  /**
  * Function to be registered into MeasurementAPI to retrieve measurements from DICOM Structured Reports
  *
  * @param {serverType} server
  * @param {object} external
  * @returns {Promise} Should resolve with OHIF measurementData object
  */

  /**
  *
  * @typedef serverType
  * @property {string} type - type of the server
  * @property {string} wadoRoot - server wado root url
  *
  */

  log.info('[DICOMSR:retrieveMeasurements] Retrieve measurements from server='+server.wadoRoot);

  if (!server || server.type !== 'dicomWeb') {
    log.error('[DICOMSR] DicomWeb server is required!');
    return Promise.reject({});
  }

  const serverUrl = server.wadoRoot;
  const studies = utils.studyMetadataManager.all();

  const _measurements = _.map(findStructuredReports(studies), (sx) => {
    return retrieveMeasurementFromSR(sx, studies, serverUrl, external);
  });

  if (_.isEmpty(_measurements)) {
    return Promise.resolve({});
  }

  // Allow for all measurement data to resolve
  const _results = await Promise.all(_measurements);
  const measurements = _.filter(_results, (r) => !_.isNil(r));

  // Merge all returned measurements into a single object instance to be
  // loaded to the measurement service.
  return Promise.resolve(_.mergeWith({}, ...measurements, (objValue, srcValue) => {

    if (_.isArray(objValue)) {
      return objValue.concat(srcValue);
    }
  }));
};


const storeMeasurements = async (measurementData, filter, server, options) => {
  /**
  *  Function to be registered into MeasurementAPI to store measurements into DICOM Structured Reports
  *
  * @param {Object} measurementData - OHIF measurementData object
  * @param {Object} filter
  * @param {serverType} server
  * @returns {Object} With message to be displayed on success
  */
  log.info('[DICOMSR] storeMeasurements');

  if (!server || server.type !== 'dicomWeb') {
    log.error('[DICOMSR] DicomWeb server is required!');
    return Promise.reject({});
  }

  const serverUrl = server.wadoRoot;
  const firstMeasurementKey = Object.keys(measurementData)[0];
  const firstMeasurement = measurementData[firstMeasurementKey][0];
  const StudyInstanceUID = firstMeasurement && firstMeasurement.StudyInstanceUID;

  try {
    await stowSRFromMeasurements(measurementData, serverUrl, options);
    if (StudyInstanceUID) {
      studies.deleteStudyMetadataPromise(StudyInstanceUID);
    }

    return {
      message: 'Measurements saved successfully',
    };
  } catch (error) {

    // Create error message
    const msg = `[DICOMSR] Error while saving the measurements: ${error.message}`
    ohifDisplay.DisplaySetApi.Instance.displaySetService.triggerApiEvent(ohifDisplay.Enums.EVENTS.DCM_TRANSFER_ERR, {
      err: error, msg,
    });
    
    // Log to console and raise error to notify user of issue
    log.error(msg);
    throw new Error('Error while saving the measurements.');
  }
};


export { retrieveMeasurements, storeMeasurements };
