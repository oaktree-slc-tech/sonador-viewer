import React from 'react';
import { DisplaySetAttributeActiveToolbarButton } from '@ohif/extension-vtk';


function ViewerVolumeCropSelectToolbarButton({
    isActiveDisplaySetAttr = 'volumeCropSelectActive', isActiveDefault = false,
    visibleDisplaySetAttr = 'volumeCroppingEnabled', ...props
  }) {
  // Toolbar button for the select ("Adjust") tool mode: crop-handle interaction on the Primary
  // mouse binding. Hidden whenever cropping is disabled (visibleDisplaySetAttr) — and therefore
  // whenever volume rendering is off; active while the select mode holds the binding.

  return (
    <DisplaySetAttributeActiveToolbarButton
      isActiveDisplaySetAttr={isActiveDisplaySetAttr} isActiveDefault={isActiveDefault}
      visibleDisplaySetAttr={visibleDisplaySetAttr}
      {...props}
    />
  );
}


export default ViewerVolumeCropSelectToolbarButton;
