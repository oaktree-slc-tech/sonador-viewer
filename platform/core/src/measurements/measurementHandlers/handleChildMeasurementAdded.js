import cornerstone from 'cornerstone-core';

import log from '../../log';
import user from '../../user';
import { MeasurementApi } from '../classes';
import getImageAttributes from '../lib/getImageAttributes';
import getLabel from '../lib/getLabel';
import refreshCornerstoneViewports from '../lib/refreshCornerstoneViewports';

export default function ({ eventData, tool, toolGroupId, toolGroup }) {
  // Event handler for single measurement updates for child measurements. Create a new instance of the provided tool.

  // @input eventData (object): data options forwarded by the OHIF event
  // - toolType (str): tool type for which the measurement should be created
  // - measurementData (object): measurement instance to be created

  // @input tool (Cornerstone Tool intsance): tool instance for which the data should be updated.

  // Retrieve measurement service data.
  const measurementApi = MeasurementApi.Instance;
  if (!measurementApi) {
    log.warn('Measurement API is not initialized');
  }

  const { measurementData } = eventData;

  const collection = measurementApi.tools[tool.parentTool];

  // Stop here if the tool data shall not be persisted (e.g. temp tools)
  if (!collection) return;

  // Stop here if there's no measurement data or if it was cancelled
  if (!measurementData || measurementData.cancelled) return;

  log.info('CornerstoneToolsMeasurementAdded');

  const imageAttributes = getImageAttributes(eventData.element);

  const additionalProperties = Object.assign(imageAttributes, {
    userId: user.getUserId(),
  });

  const childMeasurement = Object.assign({}, measurementData, additionalProperties);

  const parentMeasurement = collection.find(
    (t) => t.toolType === tool.parentTool && t.PatientID === imageAttributes.PatientID && t[tool.attribute] === null
  );

  // Check if a measurement to fit this child tool already exists
  if (parentMeasurement) {
    const key = tool.attribute;

    // Add the createdAt attribute
    childMeasurement.createdAt = new Date();

    // Update the parent measurement
    parentMeasurement[key] = childMeasurement;
    parentMeasurement.childToolsCount = (parentMeasurement.childToolsCount || 0) + 1;
    measurementApi.updateMeasurement(tool.parentTool, parentMeasurement);

    // Update the measurementData ID
    measurementData._id = parentMeasurement._id;
  } else {
    const measurement = {
      toolType: tool.parentTool,
      userId: user.getUserId(),
      PatientID: imageAttributes.PatientID,
      StudyInstanceUID: imageAttributes.StudyInstanceUID,
    };

    measurement[tool.attribute] = Object.assign({}, measurementData, additionalProperties);

    const addedMeasurement = measurementApi.addMeasurement(tool.parentTool, measurement);
    Object.assign(measurementData, addedMeasurement);
  }

  const measurementLabel = getLabel(measurementData);
  if (measurementLabel) {
    measurementData.labels = [measurementLabel];
  }

  // TODO: This is very hacky, but will work for now
  refreshCornerstoneViewports();

  // TODO: Notify about the last activated measurement

  if (MeasurementApi.isToolIncluded(tool)) {
    // TODO: Notify that viewer suffered changes
  }
}
