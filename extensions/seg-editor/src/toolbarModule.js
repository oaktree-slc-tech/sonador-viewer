import { Enums as SegEditEnums } from './enums';

import SegEditorVolumeRenderingEnabledToolbarButton from './toolbarComponents/SegEditorVolumeRenderingEnabledToolbarButton';
import SegEditorSurfaceRenderingEnabledToolbarButton from './toolbarComponents/SegEditorSurfaceRenderingEnabledToolbarButton';


const TOOLBAR_BUTTON_TYPES = {
  COMMAND: 'command',
  SET_TOOL_ACTIVE: 'setToolActive',
};

const definitions = [
  {
    id: 'ExitSegEditor',
    label: 'Exit',
    icon: 'times',
    type: TOOLBAR_BUTTON_TYPES.COMMAND,
    commandName: 'closeSegEditor',
    commandOptions: {},
    uiOptions: { layoutButtonVisible: true },
  },
  {
    // "3D" submenu: state-indicating toggles for the editor's 3D viewport rendering modes
    // (same construction as the volume viewer's "More" menu)
    id: 'SegEditor3DOptions',
    label: '3D',
    icon: 'ellipse-circle',
    buttons: [
      {
        id: 'SegEditorVolumeRenderingEnabled',
        label: '3D Volume',
        icon: 'cube',
        CustomComponent: SegEditorVolumeRenderingEnabledToolbarButton,
        type: TOOLBAR_BUTTON_TYPES.COMMAND,
        commandName: 'toggleSegEditorVolumeRendering',
        commandOptions: {},
      },
      {
        id: 'SegEditorSurfaceRenderingEnabled',
        label: 'Surface',
        icon: 'cube-3d-solid',
        CustomComponent: SegEditorSurfaceRenderingEnabledToolbarButton,
        type: TOOLBAR_BUTTON_TYPES.COMMAND,
        commandName: 'toggleSegEditorSurfaceRendering',
        commandOptions: {},
      },
    ]
  },
];


export default {
  definitions,
  defaultContext: SegEditEnums.ACTIVE_VIEWPORT,
};
