// Cornerstone tools configuration for Length Tool.
import _ from 'lodash';


const displayFunction = (measurement, options) => {
  // Unpack display data for length
  // @input measurement: OHIF v3 measurement instance
  // @returns str: display string including the length and unit values for the provided measurement

  options = options || {}
  _.defaults(options, { defaultUnit: 'mm' });

  const measurementData = measurement.measurementData || measurement.data || measurement;
  let length = measurement.length || measurementData.length || (measurementData.data || {}).length;
  const unit = measurement.unit || measurementData.unit || (measurementData.data || {}).unit || options.defaultUnit;  

  // Coerce length to number
  if (_.isString(length)) {
    length = _.toNumber(length);
  }

  let lengthValue = '';
  if (length && _.isNumber(length)) {
    lengthValue = length.toFixed(2) + ' ' + unit;
  }
  
  return lengthValue;
};


export const length = {
  id: 'Length',
  name: 'Length',
  toolGroup: 'allTools',
  cornerstoneToolType: 'Length',
  options: {
    measurementTable: {
      displayFunction,
    },
    caseProgress: {
      include: true,
      evaluate: true,
    },
  },
};