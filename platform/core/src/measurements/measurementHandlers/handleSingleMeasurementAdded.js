import cornerstone from 'cornerstone-core';

import _ from 'lodash';

import log from '../../log';
import user from '../../user';
import { MeasurementApi } from '../classes';
import getImageAttributes from '../lib/getImageAttributes';
import getLabel from '../lib/getLabel';
import refreshCornerstoneViewports from '../lib/refreshCornerstoneViewports';


export default function handleSingleMeasurementAdded({ eventData, tool }) {
  // Event handler for single measurements: add a measurement to the API.  

  const measurementApi = MeasurementApi.Instance;
  if (!measurementApi) {
    log.warn('[measurementAPI:handlers:add-measurement] Measurement API is not initialized');
  }

  // Retrieve measurement data and tool type, create a copy of measurement data to prevent property ghosting
  const { measurementData, toolType } = eventData;
  const _measurementData = _.cloneDeep(measurementData);

  const collection = measurementApi.tools[toolType];

  // Stop here if the tool data shall not be persisted (e.g. temp tools)
  if (!collection) return;

  // Stop here if there's no measurement data or if it was cancelled
  if (!_measurementData || _measurementData.cancelled) return;

  // Retrieve image and user attributes
  const imageAttributes = getImageAttributes(eventData.element);
  const userId = user.getUserId();

  // Pack measurement data structure and add to the API
  let measurement;
  const { toolServiceManaged } = measurementApi._serviceManagedTool(toolType);
  if (toolServiceManaged) {
    
    // Option 1: Tool is managed via OHIF v3 MeasurementService, move components
    // to follow OHIF v3 schema.
    measurement = {
      data: _measurementData,
      metadata: _.pick(imageAttributes, 'PatientID', 'StudyInstanceUID', 'SeriesInstanceUID', 'SOPInstanceUID', 'imagePath'),
      toolName: toolType,
    }

    //  Add tool type and frame number
    measurement.metadata.toolName = toolType
    measurement.metadata.frameNumber = imageAttributes.frameIndex;

  } else {

    // Option 2: Tool not integrated with MeasurementService,
    // merge measurement data, image attributes, and user details to a single structure
    measurement = Object.assign({}, _measurementData, imageAttributes, {
      userId: user.getUserId(),
      toolType,
    });
  }

  // Add measurement to API
  log.info('[measurementAPI:handlers:add-measurement] measurement data', measurement);

  const addedMeasurement = measurementApi.addMeasurementRepresentation(toolType, measurement);
  Object.assign(measurementData, addedMeasurement);

  const measurementLabel = getLabel(_measurementData);
  if (measurementLabel) {
    _measurementData.labels = [measurementLabel];
  }

  // TODO: This is very hacky, but will work for now
  refreshCornerstoneViewports();
}
