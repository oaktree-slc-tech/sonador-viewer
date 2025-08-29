import * as tools from '../tools';


const childTools = [];
Object.keys(tools).forEach((key) => {

  //  Add tool if it is part of allTools
  if (tools[key].toolGroup == 'allTools') {
    childTools.push(tools[key]);
  }
});


export const allTools = {
  id: 'allTools',
  name: 'Measurements',
  childTools: childTools,
  options: {
    caseProgress: {
      include: true,
      evaluate: true,
    },
  },
};
