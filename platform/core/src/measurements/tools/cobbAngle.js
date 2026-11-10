import displayFunction from './angleDisplay';

export const cobbAngle = {
  id: 'CobbAngle',
  name: 'Cobb Angle',
  toolGroup: 'allTools',
  cornerstoneToolType: 'CobbAngle',
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
