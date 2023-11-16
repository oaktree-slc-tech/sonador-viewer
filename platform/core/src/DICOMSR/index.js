import isToolSupported from './utils/isToolSupported';
import { retrieveMeasurements, storeMeasurements } from './dataExchange';

const DICOMSR = {
  retrieveMeasurements,
  storeMeasurements,
  isToolSupported,
};

export default DICOMSR;
