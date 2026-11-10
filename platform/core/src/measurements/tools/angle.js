import displayFunction from './angleDisplay';

export const angle = {
  id: 'Angle',
  name: 'Angle',
  toolGroup: 'allTools',
  cornerstoneToolType: 'Angle',
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
