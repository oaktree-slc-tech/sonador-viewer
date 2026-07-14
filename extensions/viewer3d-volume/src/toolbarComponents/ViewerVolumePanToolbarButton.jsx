import React from 'react';
import { DisplaySetAttributeActiveToolbarButton } from '@ohif/extension-vtk';

import { TOOLS as VolViewerTools } from '../enums';


function ViewerVolumePanToolbarButton({
    isActiveDisplaySetAttr = 'volumeViewerToolMode',
    isActiveDisplaySetValue = VolViewerTools.VOLVIEWER_TOOL_PAN,
    isActiveDefault = false, ...props
  }) {
  // Toolbar button for the pan tool mode. Active state derives from the volumeViewerToolMode
  // displaySet attribute (see ViewerVolumeRotateToolbarButton).

  return (
    <DisplaySetAttributeActiveToolbarButton
      isActiveDisplaySetAttr={isActiveDisplaySetAttr} isActiveDisplaySetValue={isActiveDisplaySetValue}
      isActiveDefault={isActiveDefault}
      {...props}
    />
  );
}


export default ViewerVolumePanToolbarButton;
