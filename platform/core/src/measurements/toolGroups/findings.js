import * as tools from '../tools';


const childTools = [];
Object.keys(tools).forEach((key) => {
	
	//  Add tool if it is part of allTools
  if (tools[key].toolGroup == 'findings') {
    childTools.push(tools[key]);
  }
});


export const findings = {
  id: 'findings',
  name: 'Findings',
  childTools: childTools,
  options: {
    caseProgress: {
      include: true,
      evaluate: true,
    },
  },
};
