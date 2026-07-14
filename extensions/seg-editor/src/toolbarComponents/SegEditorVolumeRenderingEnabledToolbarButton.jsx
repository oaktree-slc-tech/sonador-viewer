import React from 'react';
import { DisplaySetAttributeActiveToolbarButton } from '@ohif/extension-vtk';


function SegEditorVolumeRenderingEnabledToolbarButton({
    isActiveDisplaySetAttr = 'segEditorVolumeRenderingEnabled', isActiveDefault = false, ...props
  }) {
  // Toolbar button which toggles active or inactive depending on the state of the
  // segEditorVolumeRenderingEnabled attribute of the current displaySet (3D Volume: off by default).

  return (
    <DisplaySetAttributeActiveToolbarButton
      isActiveDisplaySetAttr={isActiveDisplaySetAttr} isActiveDefault={isActiveDefault}
      {...props}
    />
  );
}


export default SegEditorVolumeRenderingEnabledToolbarButton;
