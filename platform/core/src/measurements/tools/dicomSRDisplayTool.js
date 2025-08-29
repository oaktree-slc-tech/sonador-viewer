// DICOM-SR Display Tool configuration. The DICOM-SR display tool can be used to create read-only displays
// of points, poly-lines, and other primitives from DICOM-SR.

// This module provides a `displayFunction` that reads labels parsed from SR documents
// and creates templated key / value string representation providing more information 
// about the annotation for the display text.

import _ from 'lodash';


const displayTemplate = _.template('<% if (label) { %><%= label %> / <% } %><%= value %>');


export const dicomSRDisplayTool = {
  // Cornerstone Tools configuration for the DICOM-SR display tool

  id: 'DICOMSRDisplayTool',
  name: 'DICOMSRDisplayTool',
  toolGroup: 'allTools',
  cornerstoneToolType: 'DICOMSRDisplayTool',
  options: {
    caseProgress: { include: true, evaluate: true, },
    measurementTable: {
      
      displayFunction: (data, options) => {
        // Generate the display text that will be displayed in the measurement table
        
        options = options || {}
        _.defaults(options, { template: displayTemplate, sep: '\n', });

        // Create 
        if (data.labels && data.labels.length) {
          return _.chain(data.labels).map(options.template).value().join(options.sep);
        }

        return `(SR) ${data.TrackingIdentifier || data.measurementNumber || data.text || ''}`;
      },
    },
  },
};


export default dicomSRDisplayTool;
