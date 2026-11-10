import { CodeNameCodeSequenceValues } from '../../enums';
import { parseExtendedMeta } from '../../utils/dcmsrExtendedMeta';
import { parseDisplayAttributes } from '../../utils/dcmsrDisplayAttributes';
import { conceptNameValue } from '../../utils/codedConcept';
import { displayCoordsOf } from '../../utils/angleGeometry';

import getSequenceAsArray from './getSequenceAsArray';
import processMeasurement from './processMeasurement';


const getMeasurements = (ImagingMeasurementReportContentSequence) => {
  // Retrive an array of measurements from the ImagingMeasurementReportContentSequence array.
  // @returns array of measurement instances
  
  const ImagingMeasurements = ImagingMeasurementReportContentSequence.find(
    (item) => conceptNameValue(item) === CodeNameCodeSequenceValues.ImagingMeasurements);

  if (!ImagingMeasurements) {
    console.warn('[DICOM-SR:COORD3D:getMeasurements] unable to locate any measurement instances in the provided content sequence')
    return [];
  }

  const MeasurementGroups = getSequenceAsArray(ImagingMeasurements.ContentSequence).filter(
    (item) => conceptNameValue(item) === CodeNameCodeSequenceValues.MeasurementGroup
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
        viewsPath: 'metadata.views',
      });
      parseDisplayAttributes(MeasurementGroup, measurement, { path: 'displayAttributes' });

      // Drawn by the read-only display as the report holds it (a Cobb angle as its two lines)
      measurement.coords = displayCoordsOf(measurement.TrackingIdentifier, measurement.coords);

      measurements.push(measurement);
    }
  });

  return measurements;
};


export default getMeasurements;
