import React from 'react';
import { DisplaySetAttributeActiveToolbarButton } from '@ohif/extension-vtk';


function ViewerImageRenderingEnabledToolbarButton({
    isActiveDisplaySetAttr = 'imageVolumeRenderingEnabled', isActiveDefault = false, ...props
  }) {
  // Toolbar button which toggles active or inactive depending on the state of the imageVolumeRenderingEnabled of the current displaySet.

  return (
    <DisplaySetAttributeActiveToolbarButton 
      isActiveDisplaySetAttr={isActiveDisplaySetAttr} isActiveDefault={isActiveDefault}
      {...props}
    />
  );
}


export default ViewerImageRenderingEnabledToolbarButton;