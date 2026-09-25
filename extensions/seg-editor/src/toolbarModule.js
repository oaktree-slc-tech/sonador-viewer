import { Enums as SegEditEnums } from './enums';

import SegEditorVolumeRenderingEnabledToolbarButton from './toolbarComponents/SegEditorVolumeRenderingEnabledToolbarButton';
import SegEditorSurfaceRenderingEnabledToolbarButton from './toolbarComponents/SegEditorSurfaceRenderingEnabledToolbarButton';
import SegEditorImagingToolButtons from './toolbarComponents/SegEditorImagingToolButtons';
import SegEditor3DOptionsMenu from './toolbarComponents/SegEditor3DOptionsMenu';
import getSegEditorEvaluators from './toolbox/evaluators';


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
    // Window/Level, Zoom and Pan for the 2D views; state is held by the ToolbarService
    id: 'SegEditorImagingTools',
    label: 'Imaging Tools',
    CustomComponent: SegEditorImagingToolButtons,
  },
  {
    // "3D" submenu: state-indicating toggles for the editor's 3D viewport rendering modes
    // (same construction as the volume viewer's "More" menu). Hidden while the 3D tab shows the
    // Three.js editing canvas, which renders neither.
    id: 'SegEditor3DOptions',
    label: '3D',
    icon: 'ellipse-circle',
    CustomComponent: SegEditor3DOptionsMenu,
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


export default function getToolbarModule({ servicesManager }) {
  return {
    definitions,
    defaultContext: SegEditEnums.ACTIVE_VIEWPORT,

    // OHIF v3 ToolbarService evaluators for the tool palettes (ohif-viewers#142)
    uiTypes: getSegEditorEvaluators({ servicesManager }),
  };
}
