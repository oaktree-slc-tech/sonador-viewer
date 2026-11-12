// What a Measurements panel row needs to build its measurement's detail (core
// measurements/tools/measurementDetail): the measurement, and the calibration of the image it is on
// (pixel spacing, for the classic Cobb angle's arcs; whether the region tools' areas are in mm²).
// The row adds the modality and the region tools' lead value when it builds the detail.

import OHIF from '@ohif/core';
import { metaData as c3dMetaData } from '@cornerstonejs/core';

const positive = value => Number.isFinite(Number(value)) && Number(value) > 0;

function imagePlaneOf(imageId) {
  try {
    return imageId ? c3dMetaData.get('imagePlaneModule', imageId) : undefined;
  } catch (error) {
    return undefined;
  }
}

/**
 * The detail source of a measurement: `{ measurement, context: { pixelSpacing, calibrated } }`. A
 * measurement held in patient coordinates (out-of-plane) is calibrated by definition.
 */
export default function measurementDetailSource(measurement, { patient = false } = {}) {
  if (!measurement) {
    return undefined;
  }
  if (patient) {
    return { measurement, context: { calibrated: true } };
  }
  const MeasurementApi = OHIF.measurements && OHIF.measurements.MeasurementApi;
  const imageId = MeasurementApi && typeof MeasurementApi._getImageIdentifiers === 'function'
    ? MeasurementApi._getImageIdentifiers(measurement).imageId : measurement.referencedImageId;
  const module = imagePlaneOf(imageId);
  const row = module && module.rowPixelSpacing;
  const column = module && module.columnPixelSpacing;
  const calibrated = positive(row) && positive(column);
  return {
    measurement,
    context: { calibrated, pixelSpacing: calibrated ? { row: Number(row), column: Number(column) } : undefined },
  };
}

export { measurementDetailSource };
