import React from 'react';
import { DisplaySetAttributeActiveToolbarButton } from '@ohif/extension-vtk';


function SegEditorSurfaceRenderingEnabledToolbarButton({
    isActiveDisplaySetAttr = 'segEditorSurfaceRenderingEnabled', isActiveDefault = true, ...props
  }) {
  // Toolbar button which toggles active or inactive depending on the state of the
  // segEditorSurfaceRenderingEnabled attribute of the current displaySet (Surface: on by default).

  return (
    <DisplaySetAttributeActiveToolbarButton
      isActiveDisplaySetAttr={isActiveDisplaySetAttr} isActiveDefault={isActiveDefault}
      {...props}
    />
  );
}


export default SegEditorSurfaceRenderingEnabledToolbarButton;
