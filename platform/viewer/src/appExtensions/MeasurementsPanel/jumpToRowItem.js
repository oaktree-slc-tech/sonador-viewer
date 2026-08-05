import _ from 'lodash';

import { measurements, utils } from '@ohif/core';
import { extractStudyIdFromURL } from '@ohif/core/src/utils/extractStudyIdFromURL';

import { servicesManager } from '../../App';
const { MeasurementApi } = measurements;
const { studyMetadataManager } = utils;

// TODO: Move this function to OHIF itself so we can use it on the OHIF measurment table (when it is finished)


export default function jumpToRowItem(
  /**
  * Activates a set of measurements
  *
  * @param measurementData
  * @param viewportsState
  * @param timepointManagerState
  * @param options
  *   - layout (array, default=[]): layout which should be laded by the viewer
  */
  measurement,
  viewportsState,
  timepointManagerState,
  options = { invertViewportTimepointsOrder: false, childToolKey: null, layout: []}
) {
  const viewports = viewportsState.layout.viewports;
  const activeViewportIndex = viewportsState.activeViewportIndex;
  const activeViewport = viewports[activeViewportIndex];
  if (activeViewport.vtk) {
    const error = new Error('Measurements are not supported by the MPR mode.');
    const { LoggerService } = servicesManager.services;

    // One call: console, unified Issues list, and a toast (ohif-viewers#84).
    LoggerService.error({
      error,
      title: 'Measurements panel',
      message: error.message,
      notify: true,
      studyInstanceUID: extractStudyIdFromURL(),
    });
    return {
      viewportSpecificData: [],
      layout: [], // TODO: if we need to change layout, we should return this here
    };
  }

  // Determine number of viewports and display settings
  const numViewports = viewportsState.layout.viewports.length;
  const numTimepoints = timepointManagerState.timepoints.length;
  const { measurements, timepoints } = timepointManagerState;
  
  const numViewportsToUpdate = Math.min(numTimepoints, numViewports);
  
  // Retrieve tool type
  const toolType = MeasurementApi._getToolType(measurement);

  // Unpack measurement data attributes
  const { measurementMeta, measurementData, uid, _id } = MeasurementApi._unpackMeasurementData(measurement);
  const measurementNumber = measurementData.measurementNumber || measurementMeta.measurementNumber || measurement.measurementNumber;

  if (options.invertViewportTimepointsOrder) {
    timepoints.reverse();
  }

  const measurementsForToolGroup = measurements[toolType];

  // Retrieve the measurements data
  const measurementsToJumpTo = [];

  for (let i = 0; i < numViewportsToUpdate; i++) {
    const { timepointId } = timepoints[i];

    const dataAtThisTimepoint = measurementsForToolGroup.find((entry) => {      
      return entry.timepointId === timepointId && entry.measurementNumber === measurementNumber;
    });

    // Unable to retrieve an entry for the timepoint, move to next measurement in queue
    if (!dataAtThisTimepoint) {
      measurementsToJumpTo.push(null);
      continue;
    }
    
    // Retrieve measurement instance to load
    let _measurement;
    const { toolServiceManaged } = MeasurementApi.Instance._serviceManagedTool(toolType);

    if (toolServiceManaged) {

      // Retrieve measurement from service
      const { _id: timepointId, uid: timePointUid } = MeasurementApi._unpackMeasurementData(dataAtThisTimepoint);
      _measurement = MeasurementApi.Instance.measurementService.getMeasurement(timePointUid);

    } else {

      // Use data from current timepoint
      _measurement = dataAtThisTimepoint;
    }    

    // Retrieve chidl measurements which may be associated with the selected row
    const { tool } = MeasurementApi.getToolConfiguration(toolType);
    if (options.childToolKey) {
      _measurement = dataAtThisTimepoint[options.childToolKey];
    } else if (Array.isArray(tool.childTools)) {
      const key = tool.childTools.find((key) => !!dataAtThisTimepoint[key]);
      _measurement = dataAtThisTimepoint[key];
    }

    // Append annotation to measurements to jump to
    if (_measurement) {
      measurementsToJumpTo.push(_measurement);
    }
  }

  // TODO: Add a single viewports state action which allows
  // - viewportData to be set
  // - layout to be set
  // - activeViewport to be set

  // Needs to update viewports.viewportData state to set image set data

  const displaySetContainsSopInstance = (displaySet, SOPInstanceUID) => {

    if (!displaySet.images || !displaySet.images.length) {
      log.warn('[viewer:measurementTable:jumpToRowItem] display set does not include any images, skip viewport update');
      return;
    }

    return displaySet.images.find((image) => image.getSOPInstanceUID() === SOPInstanceUID);
  };

  const viewportSpecificData = [];
  measurementsToJumpTo.forEach((data, viewportIndex) => {
    
    // Skip if there is no measurement to jump to
    if (!data) {
      return;
    }

    // Unpack measurement attributes
    const { measurementMeta: _meta, measurementData: _data, uid: measurementUid, _id: measurementId } = MeasurementApi._unpackMeasurementData(data);
    const referenceStudyUID = _meta.referenceStudyUID || _meta.StudyInstanceUID || data.referenceStudyUID || data.StudyInstanceUID;
    const sopInstanceUid = data.SOPInstanceUID || _data.sopInstanceUid || _meta.SOPInstanceUID;

    console.debug('[viewer:measurementTable:jumpToRowItem] study ', referenceStudyUID, sopInstanceUid, data);
    const study = studyMetadataManager.get(referenceStudyUID);
    if (!study) {
      throw new Error('[viewer:measurementTable:jumpToRowItem] Unable to update viewport, study not found. StudyInstanceUID='+referenceStudyUID);
    }

    // Find display sets associated with the SOP instance UID
    const displaySet = study.findDisplaySet((displaySet) => {
      return displaySetContainsSopInstance(displaySet, sopInstanceUid);
    });

    if (!displaySet) {
      const emsg = '[viewer:measurementTable:jumpToRowItem] Unable to navigate to selected measurement, display set not found'
      console.error(emsg, data);
      throw new Error(emsg);
    }

    displaySet.SOPInstanceUID = data.SOPInstanceUID;
    if (data.frameIndex) {
      displaySet.frameIndex = data.frameIndex;
    }

    // Create viewport layout structure (number and IDs of display sets)
    viewportIndex = (viewportIndex + viewportsState.activeViewportIndex) % numViewports;
    viewportSpecificData.push({
      viewportIndex,
      displaySet,
    });

    // Trigger measurement service events (for measurements registered with the service)
    if (measurementUid) {
      MeasurementApi.Instance.measurementService.jumpToMeasurement(viewportIndex, measurementUid);
    }
  });

  // Return viewport data to trigger layout
  return {
    viewportSpecificData,
    layout: options.layout || [],
  };
}
