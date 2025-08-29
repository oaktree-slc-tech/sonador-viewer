// DICOM Series Tag Tool configuration. The DICOM Series Tag tool can be used to add series annotations
// which describe qualitative data to a series.

import _ from 'lodash';


const displayTemplate = _.template('<%= value %><% if (text) { %> / <%= text %><% } %>');


export const dicomSeriesTagTool = {
  // Cornerstone Tools configuration for the DICOM Series Tag tool
  id: 'DICOMSRSeriesTagTool',
  name: 'DICOMSRSeriesTagTool',
  toolGroup: 'findings',
  cornerstoneToolType: 'DICOMSRSeriesTagTool',
  options: {
    caseProgress: { include: true, evaluate: true, },
    measurementTable: {
      
      displayFunction: (data, options) => {
        // Generate the display trext that will be displayed in the measurement table
        options = options || {};
        _.defaults(options, { template: displayTemplate });

        // Generate the display text that will be displayed in the measurement table
        return data.value ? options.template(data): '...';
      },
    },
  },
}


export default dicomSeriesTagTool;