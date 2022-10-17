import { targets } from './toolGroups/targets';
import { nonTargets } from './toolGroups/nonTargets';
import { temp } from './toolGroups/temp';
import * as _ from 'lodash';

const ltTools = _.cloneDeep([targets, nonTargets, temp]);

ltTools.forEach(toolGroup => {
  toolGroup.childTools.forEach(tool => {
    tool.toolGroup = toolGroup.id;
  });
});

export default ltTools;
