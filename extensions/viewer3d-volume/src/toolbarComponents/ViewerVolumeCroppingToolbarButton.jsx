import React from 'react';
import { DisplaySetAttributeActiveToolbarButton } from '@ohif/extension-vtk';


function ViewerVolumeCroppingToolbarButton({
    isActiveDisplaySetAttr = 'volumeCroppingEnabled', isActiveDefault = false,
    visibleDisplaySetAttr = 'imageVolumeRenderingEnabled', ...props
  }) {
  // Toolbar button for the volume cropping tool. Three states driven by the displaySet:
  // hidden while volume rendering is off (visibleDisplaySetAttr), inactive when volume rendering
  // is on and cropping is off, active (highlighted) when cropping is enabled.

  return (
    <DisplaySetAttributeActiveToolbarButton
      isActiveDisplaySetAttr={isActiveDisplaySetAttr} isActiveDefault={isActiveDefault}
      visibleDisplaySetAttr={visibleDisplaySetAttr}
      {...props}
    />
  );
}


export default ViewerVolumeCroppingToolbarButton;
