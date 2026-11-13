// The Bidirectional (long and short axis) as the Measurements panel lists it: `L x W mm`, two
// decimals, from a classic tool's or a record's `longestDiameter` / `shortestDiameter`, or
// Cornerstone3D statistics (DICOMSR bidirectionalGeometry.js).

import { bidirectionalDisplayValues, bidirectionalText } from '../../DICOMSR/utils/bidirectionalGeometry';

const displayFunction = data => bidirectionalText(bidirectionalDisplayValues(data));

export const bidirectional = {
  id: 'Bidirectional',
  name: 'Target',
  toolGroup: 'allTools',
  cornerstoneToolType: 'Bidirectional',
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
