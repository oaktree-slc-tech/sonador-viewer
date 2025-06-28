import { allTools } from './toolGroups/allTools';
import {
  disassociateStudy,
  removeTimepoint,
  retrieveMeasurements,
  retrieveTimepoints,
  storeMeasurements,
  storeTimepoints,
  updateTimepoint,
} from './dataExchange';

const measurementApiDefaultConfig = {
  measurementTools: [allTools],
  dataExchange: {
    retrieve: retrieveMeasurements,
    store: storeMeasurements,
  },
};

const timepointApiDefaultConfig = {
  dataExchange: {
    retrieve: retrieveTimepoints,
    store: storeTimepoints,
    remove: removeTimepoint,
    update: updateTimepoint,
    disassociate: disassociateStudy,
  },
};

export { measurementApiDefaultConfig, timepointApiDefaultConfig };
