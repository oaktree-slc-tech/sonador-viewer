import _ from 'lodash';
import cornerstone from 'cornerstone-core';

import log from '../../log';
import { MeasurementApi } from '../classes';
import refreshCornerstoneViewports from '../lib/refreshCornerstoneViewports';


export default function handleSingleMeasurementRemoved({ eventData, tool, toolGroupId, toolGroup }) {
  // Event handler for single measurements. Remove the specified measurements (and children) from the API.
  
  // @input eventData (object): data options forwarded by the OHIF event
  //  - toolType (str): tool type for which the measurements should be removed
  //  - measurementData (object): measurement instance to be targeted for removal
  //  - matchUid (bool, default=false): adds _id to the filter used for matching measurements,
  //    providing a more rigorous check to ensure that only specific instances are removed.
  
  // @input tool (Cornerstone Tool instance): tool instance for which the data should be removed.
  //    Used to trigger notifications.
  
  const { measurementData, toolType } = eventData;
  log.info('[measurementAPI:handlers:remove-measurement] toolType='+toolType+', event data', eventData);

  // Unpack measurement data
  const _id = measurementData._id;
  const uid = measurementData.uid || measurementData._measurementServiceUid;

  const measurementApi = MeasurementApi.Instance;
  if (!measurementApi) {
    log.warn('[measurementAPI:handlers:remove-measurement] Measurement API is not initialized');
  }

  const collection = measurementApi.tools[toolType];

  // Stop here if the tool data shall not be persisted (e.g. temp tools)
  if (!collection) return;

  const measurementTypeId = measurementApi.toolsGroupsMap[toolType];
  const measurement = collection.find((t) => {
    return t._id === _id || t.uid == uid;
  });

  // Stop here if the measurement is already gone or never existed
  if (!measurement) {

    // Attempt to remove measurement data from global tool state
    if (eventData.element) {

      // Ensure that the measurement includes a reference to the toolType
      measurementData.toolType = toolType;

      // Add reference to the element and viewport
      measurementData.element = eventData.element;
      measurementData.viewport = cornerstone.getViewport(eventData.element);

      // Purge measurement from global state
      MeasurementApi.purgeCornerstoneMeasurementData(measurementData);
      refreshCornerstoneViewports();

    } else {
      log.warn('[measurementAPI:handlers:remove-measurement] unable to locate measurement matching event data', 
        measurementData, 'collection', collection, 'tools map', measurementApi.tools);
    }
    
    return;
  }

  // Remove all the measurements with the given type and number
  const { timepointId, } = measurement;

  // Create filter to remove measurements
  const _filter = {
    timepointId, toolId: toolType,
  };

  
  let options = {};

  // Create measurement UID whitelist to prevent removal of measurements not indicated for deletion
  if (_id || uid) {
    if (_id) {
      options._ids = [_id];  
    }
    if (uid) {
      options.uids = [uid];
    }
  }
  
  // Remove measurements from the API and trigger update of viewport
  measurementApi.deleteMeasurements(toolType, measurementTypeId, _filter, options);
  measurementApi.syncMeasurementsAndToolData()
  refreshCornerstoneViewports();
}
