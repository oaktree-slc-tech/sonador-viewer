import displayFunction from './circleDisplay';

export const circleRoi = {
  id: 'CircleRoi',
  name: 'Circle',
  toolGroup: 'allTools',
  cornerstoneToolType: 'CircleRoi',
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
