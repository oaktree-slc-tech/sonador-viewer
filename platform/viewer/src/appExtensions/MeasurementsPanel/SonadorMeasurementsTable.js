import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

import ConnectedMeasurementTable from './ConnectedMeasurementTable.js';
import { measurements, utils } from '@ohif/core';

const { MeasurementApi } = measurements;


const SonadorMeasurementTable = ({servicesManager, ...props}) => {
  // Version of the Sonador Measurement table which responds to changes in service state.
  // Table renders are controlled by changing the table GUID (component key).
  
  // @signal-handler MeasurementService.EVENTS.MEASUREMENT_UPDATED: re-render item list on programmtic update
  //    of table measurements.
  // @signal-handler MeasurementService.EVENTS.MEASUREMENTS_DATASYNC: re-render table components after
  //    the measurements service has been cleared.

  const measurementApi = MeasurementApi.Instance;

  // State properties
  const [version, setVersion] = useState(utils.guid());

  useEffect(() => {
    // Manage subscriptions to services and external events
    
    // Event handler: measurement updates
    const measurement_updated_subscription = measurementApi.measurementService.subscribe(
      measurementApi.measurementService.EVENTS.MEASUREMENT_UPDATED, ({ measurement, notYetUpdatedAtSource })=> {

        // Create a new version string to trigger re-render of measurement table (required to reload table item data).
        // setTimeout is used to prevent nested component update issues.
        if (notYetUpdatedAtSource) {
          setTimeout(() => { setVersion(utils.guid()); }, props.renderTimeout);
        }
      });
    
    // Event handlers: datasync events
    const measurement_datasync_subscription = measurementApi.measurementService.subscribe(
      measurementApi.measurementService.EVENTS.MEASUREMENTS_DATASYNC, ({ apiEvent, ...apiData }) => {
        
        // Trigger re-load of measurement table data
        console.log('[ui:measurementTable:measurement-event:api-datasync] apiEvent='+apiEvent);

        // Measurement representation update
        if (apiEvent && (
            apiEvent == measurements.Enums.EVENTS.MEASUREMENT_REPRESENTATION_ADDED
            || apiEvent == measurements.Enums.EVENTS.MEASUREMENT_REPRESENTATION_UPDATED
          )) {
          const { measurementRepresentation } = apiData;
          console.log('[ui:measurementTable:measurement-event:api-datasync] apiEvent='+apiEvent, measurementRepresentation);
        }

        if (apiEvent && apiEvent == measurements.Enums.EVENTS.MEASUREMENT_CLEAR_SUCCESS) {

          // Increment table version to force re-render
          setVersion(utils.guid());
        }
      });
    
    return () => {
      // Unsubscribe from external service subscriptions

      measurement_updated_subscription.unsubscribe();
      measurement_datasync_subscription.unsubscribe();
    }
  }, []);

  return <ConnectedMeasurementTable key={version} servicesManager={servicesManager} {...props} />;
}


SonadorMeasurementTable.propType = {
  renderTimeout: PropTypes.number.isRequired,
}


SonadorMeasurementTable.defaultProps = {
  renderTimeout: 50,
}



export default SonadorMeasurementTable;