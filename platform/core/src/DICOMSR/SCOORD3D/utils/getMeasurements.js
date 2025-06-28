import { CodeNameCodeSequenceValues } from '../../enums';
import { parseExtendedMeta } from '../../utils/dcmsrExtendedMeta';

import getSequenceAsArray from './getSequenceAsArray';
import processMeasurement from './processMeasurement';


const getMeasurements = (ImagingMeasurementReportContentSequence) => {
  // Retrive an array of measurements from the ImagingMeasurementReportContentSequence array.
  // @returns array of measurement instances
  
  const ImagingMeasurements = ImagingMeasurementReportContentSequence.find(
    (item) => item.ConceptNameCodeSequence.CodeValue === CodeNameCodeSequenceValues.ImagingMeasurements);

  if (!ImagingMeasurements) {
    console.warn('[DICOM-SR:COORD3D:getMeasurements] unable to locate any measurement instances in the provided content sequence')
    return [];
  }

  const MeasurementGroups = getSequenceAsArray(ImagingMeasurements.ContentSequence).filter(
    (item) => item.ConceptNameCodeSequence.CodeValue === CodeNameCodeSequenceValues.MeasurementGroup
  );

  let measurements = [];

  MeasurementGroups.forEach((MeasurementGroup) => {

    // Create measurement instance for each group
    const contentSequence = MeasurementGroup.ContentSequence;
    const measurement = processMeasurement(contentSequence);

    if (measurement) {

      // Check for extended attributes
      parseExtendedMeta(MeasurementGroup, measurement, {
        textPath: 'metadata.text',
        locationPath: 'metadata.location',
      });

      measurements.push(measurement);
    }
  });

  return measurements;
};


export default getMeasurements;
