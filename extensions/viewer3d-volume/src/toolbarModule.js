import { DisplaySetAttributeActiveToolbarButton } from '@ohif/extension-vtk';

import Viewer3DCTToolbarButton from './toolbarComponents/Viewer3DToolbarButton';
import ViewerImageRenderingEnabledToolbarButton from './toolbarComponents/ViewerImageRenderingEnabledToolbarButton';
import ViewerSegmentationSurfaceEnabledToolbarButton from './toolbarComponents/ViewerSegmentationSurfaceEnabledToolbarButton';
import ViewerVolumeCroppingToolbarButton from './toolbarComponents/ViewerVolumeCroppingToolbarButton';
import ViewerVolumeCropSelectToolbarButton from './toolbarComponents/ViewerVolumeCropSelectToolbarButton';
import ViewerVolumeRotateToolbarButton from './toolbarComponents/ViewerVolumeRotateToolbarButton';
import ViewerVolumePanToolbarButton from './toolbarComponents/ViewerVolumePanToolbarButton';

import VolViewerEnums from './enums';


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
    uiOptions: { layoutButtonVisible: true },
  },
  {
    // Rotate/Pan active states derive from the volumeViewerToolMode displaySet attribute
    // (command type rather than setToolActive: mode changes also arrive from commands and the
    // cropping auto-transitions, which ToolbarRow's click-driven activeButtons state never sees)
    id: 'CT3DVolumeRotate',
    label: 'Rotate',
    icon: 'crosshairs',
    CustomComponent: ViewerVolumeRotateToolbarButton,
    type: TOOLBAR_BUTTON_TYPES.COMMAND,
    commandName: 'enableVolumeRotateTool',
    commandOptions: {},
  },
  {
    id: 'CT3DVolumePan',
    label: 'Pan',
    icon: 'arrows',
    CustomComponent: ViewerVolumePanToolbarButton,
    type: TOOLBAR_BUTTON_TYPES.COMMAND,
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
    id: 'CTViewportOptions',
    label: 'More',
    icon: 'ellipse-circle',
    buttons: [
      {
        id: 'CTVolumeRenderingEnabled',
        label: '3D Volume',
        icon: 'cube',
        CustomComponent: ViewerImageRenderingEnabledToolbarButton,
        type: TOOLBAR_BUTTON_TYPES.COMMAND,
        commandName: 'toggleVolumeRendering',
        commandOptions: {},
      },
      {
        id: 'CTVolumeSegmentationSurfaceEnabled',
        label: 'Segmentations',
        icon: 'cube-3d-solid',
        CustomComponent: ViewerSegmentationSurfaceEnabledToolbarButton,
        type: TOOLBAR_BUTTON_TYPES.COMMAND,
        commandName: 'toggleSegmentationSurface',
        commandOptions: {},
      }
    ]
  },
  {
    // Volume cropping toggle: hidden while volume rendering is off, inactive/active with the
    // cropping tool state (three-state widget over displaySet.volumeCroppingEnabled)
    id: 'CTVolumeCropping',
    label: 'Crop',
    icon: 'crop',
    CustomComponent: ViewerVolumeCroppingToolbarButton,
    type: TOOLBAR_BUTTON_TYPES.COMMAND,
    commandName: 'toggleVolumeCropping',
    commandOptions: {},
  },
  {
    // Select ("Adjust") mode: crop-handle interaction on the Primary binding. Hidden unless
    // cropping is enabled; active state tracks displaySet.volumeCropSelectActive.
    id: 'CTVolumeCropSelect',
    label: 'Adjust',
    icon: 'dot-circle',
    CustomComponent: ViewerVolumeCropSelectToolbarButton,
    type: TOOLBAR_BUTTON_TYPES.COMMAND,
    commandName: 'enableVolumeSelectTool',
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
    uiOptions: { layoutButtonVisible: false },
  },
];

export default {
  definitions,
  defaultContext: VolViewerEnums.ACTIVE_VIEWPORT,
};
