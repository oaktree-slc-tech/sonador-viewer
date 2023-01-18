import { vtkVolumeColorPresetSelector } from '@ohif/extension-vtk';
import Viewer3DCTToolbarButton from './toolbarComponents/Viewer3DToolbarButton.js';

const TOOLBAR_BUTTON_TYPES = {
  COMMAND: 'command',
  SET_TOOL_ACTIVE: 'setToolActive',
};

const definitions = [
  {
    id: 'Exit3DVolumeViewer',
    label: 'Exit 3D Viewer',
    icon: 'times',
    type: TOOLBAR_BUTTON_TYPES.COMMAND,
    commandName: 'closeViewer3d',
    commandOptions: {},
  },
  {
    id: 'CTVolumePresetSelector',
    label: 'Change Rendering Options',
    type: TOOLBAR_BUTTON_TYPES.COMMAND,
    commandName: 'setVtkVolumeColorPreset',
    CustomComponent: vtkVolumeColorPresetSelector,
  },
  {
    id: 'CT3DVolumeRotate',
    label: 'Rotate',
    icon: 'crosshairs',
    type: TOOLBAR_BUTTON_TYPES.SET_TOOL_ACTIVE,
    commandName: 'enableVolumeRotateTool',
    commandOptions: {},
  },
  {
    id: 'CT3DVolumeWWDC',
    label: 'Levels',
    icon: 'level',
    type: TOOLBAR_BUTTON_TYPES.SET_TOOL_ACTIVE,
    commandName: 'enableVolumeLevelTool',
    commandOptions: {},
  },
  {
    id: 'CT3DVolumePan',
    label: 'Pan',
    icon: 'arrows',
    type: TOOLBAR_BUTTON_TYPES.SET_TOOL_ACTIVE,
    commandName: 'enableVolumePanTool',
    commandOptions: {},
  },
  {
    id: 'CTVolumeReset',
    label: 'Reset',
    icon: 'reset',
    type: TOOLBAR_BUTTON_TYPES.COMMAND,
    commandName: 'resetCTVolumeView',
    commandOptions: {},
  },
  {
    id: 'CT3DVolumeViewer',
    label: '3D Volume',
    icon: 'viewer3d01',
    CustomComponent: Viewer3DCTToolbarButton,
    type: TOOLBAR_BUTTON_TYPES.COMMAND,
    commandName: 'viewer3dCT',
    context: 'ACTIVE_VIEWPORT::CORNERSTONE',
  },
];

export default {
  definitions,
  defaultContext: 'ACTIVE_VIEWPORT::VIEWER3DVOL',
};
