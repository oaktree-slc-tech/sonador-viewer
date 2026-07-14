import { TOOLBAR_BUTTON_TYPES } from '@ohif/ui';
import { Enums as CornerstoneEnums } from '@ohif/extension-cornerstone';

import { VTKMPRToolbarButton } from './toolbarComponents/VTKMPRToolbarButton';

import { Enums as vtkEnums } from './enums';


const definitions = [
  {
    id: 'Crosshairs',
    label: 'Crosshairs',
    icon: 'crosshairs',
    //
    type: TOOLBAR_BUTTON_TYPES.SET_TOOL_ACTIVE,
    commandName: 'enableCrosshairsTool',
    commandOptions: {},
  },
  {
    id: 'WWWC',
    label: 'Levels',
    icon: 'level',
    //
    type: TOOLBAR_BUTTON_TYPES.SET_TOOL_ACTIVE,
    commandName: 'enableMprLevelTool',
    commandOptions: {},
  },
  {
    id: 'Reset',
    label: 'Reset',
    icon: 'reset',
    //
    type: TOOLBAR_BUTTON_TYPES.COMMAND,
    commandName: 'resetMprView',
    commandOptions: {},
  },
  {
    id: '2DMPR',
    label: '2D MPR',
    icon: 'cube',
    CustomComponent: VTKMPRToolbarButton,
    type: TOOLBAR_BUTTON_TYPES.COMMAND,
    commandName: 'mpr2d',
    context: CornerstoneEnums.ACTIVE_VIEWPORT,
    uiOptions: { layoutButtonVisible: false },
  },
];


export default {
  definitions,
  defaultContext: vtkEnums.ACTIVE_VIEWPORT,
};
