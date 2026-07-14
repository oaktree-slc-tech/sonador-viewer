import React from 'react';
import { DisplaySetAttributeActiveToolbarButton } from '@ohif/extension-vtk';

import { TOOLS as VolViewerTools } from '../enums';


function ViewerVolumeRotateToolbarButton({
    isActiveDisplaySetAttr = 'volumeViewerToolMode',
    isActiveDisplaySetValue = VolViewerTools.VOLVIEWER_TOOL_DEFAULT,
    isActiveDefault = true, ...props
  }) {
  // Toolbar button for the default (rotate-led) tool mode. Active state derives from the
  // volumeViewerToolMode displaySet attribute, so it stays mutually exclusive with the Pan and
  // Adjust widgets regardless of whether the mode changed via toolbar click, command, or the
  // cropping auto-transitions. Rotate is the viewer's initial mode (isActiveDefault).

  return (
    <DisplaySetAttributeActiveToolbarButton
      isActiveDisplaySetAttr={isActiveDisplaySetAttr} isActiveDisplaySetValue={isActiveDisplaySetValue}
      isActiveDefault={isActiveDefault}
      {...props}
    />
  );
}


export default ViewerVolumeRotateToolbarButton;
