// Measurements-table text of an Angle or Cobb angle: the value in degrees, two decimals. The value
// is kept at the top of the tool data, or in `data` of a service measurement; 0 is a valid value,
// an absent or non-numeric one shows nothing.

const isValue = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

export default function angleDisplay(data) {
  const rAngle = [data.rAngle, data.data && data.data.rAngle, data.measurementData && data.measurementData.rAngle]
    .find(isValue);
  return rAngle === undefined ? '' : Number(rAngle).toFixed(2) + String.fromCharCode(parseInt('00B0', 16));
}
