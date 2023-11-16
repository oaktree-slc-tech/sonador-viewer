import processNonGeometricallyDefinedMeasurement from './processNonGeometricallyDefinedMeasurement';
import processTID1410Measurement from './processTID1410Measurement';

const processMeasurement = (contentSequence) => {
  if (contentSequence.some((group) => group.ValueType === 'SCOORD' || group.ValueType === 'SCOORD3D')) {
    return processTID1410Measurement(contentSequence);
  }

  return processNonGeometricallyDefinedMeasurement(contentSequence);
};

export default processMeasurement;
