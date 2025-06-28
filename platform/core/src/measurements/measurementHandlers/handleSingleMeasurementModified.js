import _ from 'lodash';
import cornerstone from 'cornerstone-core';

import log from '../../log';
import { MeasurementApi } from '../classes';


export default function ({ eventData, tool, toolGroupId, toolGroup }) {
  // Event handler for single measurement updates. Update the specified instance (and children) from the API.
  
  // @input eventData (object): data options forwarded by the OHIF event
  //  - toolType (str): tool type for which the measurements should be updated
  //  - measurementData (object): measurement instance to be updated
  
  // @input tool (Cornerstone Tool instance): tool instance for which the data should be updated.

  // Retrieve measurement API instance
  const measurementApi = MeasurementApi.Instance;
  if (!measurementApi) {
    log.warn('[measurementAPI:handlers:update-measurement] Measurement API is not initialized');
  }

  // Unpack measurement attributes
  const { measurementData, toolType } = eventData;
  const { _id, uid } = MeasurementApi._unpackMeasurementData(measurementData);

  const collection = measurementApi.tools[toolType];

  // Retrieve measurement service config
  const { toolServiceManaged } = measurementApi._serviceManagedTool(toolType);
  log.info('[measurementAPI:handlers:update-measurement] measurement modified toolType='+toolType+' _id='+_id+' uid='+uid);;

  // Stop here if the tool data shall not be persisted (e.g. temp tools)
  if (!collection || !collection.length) {
    log.warn('[measurementAPI:handlers:update-measurement] unable to retrieve collection for toolType='+toolType+' or the collection is empty.');

    if (toolServiceManaged) {
      measurementApi.rebuildMeasurementRepresentations(toolType);
    };
    return;
  } 
  
  // Match tool data to provided measurement
  let measurement = collection.find((t) => t._id === _id);

  // Measurement cannot be found, check measurement service. If the measurement is still registered to the service,
  // restore the measurement version of the data before posting the update.
  if (!measurement) {
    log.warn('[measurementAPI:handlers:update-measurement] unable to locate measurement matching event data', eventData);

    if (toolServiceManaged) {
      const measurement0 = measurementApi.measurementService.getMeasurement(uid);
      if (measurement0 && measurement0.source.getAnnotation) {

        // Restore measurement record from service and proceed with update
        measurementApi.addMeasurementRepresentation(toolType, measurement0.source.getAnnotation(uid));
        log.info('[measurementAPI:handlers:update-measurement] restore measurement id_='+_id+' uid='+uid+' from service', measurement0);

      } else {
        log.info('[measurementAPI:handlers:update-measurement] unable to locate service record for id_='+_id+' uid='+uid+'. Abort update.');
        return;
      }
    } else {
      return;
    }
  }

  // Ensure that lifecycle attributes are not lost during the update. Lifecycle attributes should be pulled from
  // the measurement service and attached to the metadata section of attributes.
  if (toolServiceManaged) {
    const measurement0 = measurementApi.measurementService.getMeasurement(uid);
    if (measurement0) {
      const _meta = MeasurementApi._unpackMeasurementLifecycleAttrs(measurement0);

      // Copy attributes to measurement
      if (!measurementData.metadata) measurementData.metadata = {};
      _.defaults(measurementData.metadata, _meta);
    }
  }

  // Update tool metadata
  measurement = Object.assign(measurement, measurementData);
  measurement.viewport = cornerstone.getViewport(eventData.element);

  measurementApi.updateMeasurementRepresentation(toolType, measurement);
}
