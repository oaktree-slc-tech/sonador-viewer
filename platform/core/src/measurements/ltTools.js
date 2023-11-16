import * as _ from 'lodash';

import { nonTargets } from './toolGroups/nonTargets';
import { targets } from './toolGroups/targets';
import { temp } from './toolGroups/temp';

const ltTools = _.cloneDeep([targets, nonTargets, temp]);

ltTools.forEach((toolGroup) => {
  toolGroup.childTools.forEach((tool) => {
    tool.toolGroup = toolGroup.id;
  });
});

export default ltTools;
