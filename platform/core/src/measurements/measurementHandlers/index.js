import { MeasurementApi } from '../classes';

import handleChildMeasurementAdded from './handleChildMeasurementAdded';
import handleChildMeasurementModified from './handleChildMeasurementModified';
import handleChildMeasurementRemoved from './handleChildMeasurementRemoved';
import handleSingleMeasurementAdded from './handleSingleMeasurementAdded';
import handleSingleMeasurementModified from './handleSingleMeasurementModified';
import handleSingleMeasurementRemoved from './handleSingleMeasurementRemoved';

const getEventData = (event) => {
  const eventData = event.detail;
  if (eventData.toolName) {
    eventData.toolType = eventData.toolName;
  }

  return eventData;
};

const MeasurementHandlers = {
  handleSingleMeasurementAdded,
  handleChildMeasurementAdded,
  handleSingleMeasurementModified,
  handleChildMeasurementModified,
  handleSingleMeasurementRemoved,
  handleChildMeasurementRemoved,

  onAdded(event) {
    const eventData = getEventData(event);
    const { toolType } = eventData;
    const { toolGroupId, toolGroup, tool } = MeasurementApi.getToolConfiguration(toolType);
    const params = {
      eventData,
      tool,
      toolGroupId,
      toolGroup,
    };

    if (!tool) return;

    if (tool.parentTool) {
      handleChildMeasurementAdded(params);
    } else {
      handleSingleMeasurementAdded(params);
    }
  },

  onModified(event) {
    const eventData = getEventData(event);
    const { toolType } = eventData;
    const { toolGroupId, toolGroup, tool } = MeasurementApi.getToolConfiguration(toolType);
    const params = {
      eventData,
      tool,
      toolGroupId,
      toolGroup,
    };

    if (!tool) return;

    if (tool.parentTool) {
      handleChildMeasurementModified(params);
    } else {
      handleSingleMeasurementModified(params);
    }
  },

  onRemoved(event) {
    // Event handlers for measurement::remove events.

    const eventData = getEventData(event);
    console.log('[measurements:event:onRemoved] event data', eventData);

    // Retrieve tool type, group ID, and tool configuration
    const { toolType } = eventData;
    const { toolGroupId, toolGroup, tool } = MeasurementApi.getToolConfiguration(toolType);

    // Pack arguments to remove the specified measurements
    const params = {
      eventData,
      tool,
      toolGroupId,
      toolGroup,
    };

    if (!tool) {
      console.log('[measurements:event:onRemoved] no tool specified, cancel measurement removal');
      return;
    }

    if (tool.parentTool) {
      handleChildMeasurementRemoved(params);
    } else {
      handleSingleMeasurementRemoved(params);
    }
  },
};

export default MeasurementHandlers;
