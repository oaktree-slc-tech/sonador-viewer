import React from 'react';
import { useSelector } from 'react-redux';
import PropTypes from 'prop-types';

import { redux } from '@ohif/core';
import { ToolbarButton } from '@ohif/ui';


export default function SonadorSegmentationViewer3DVToggleButton({ toolbarClickCallback, button, isActive }) {
  // Toolbar able to toggle between visible/hidden and active/inactive based on the state of the
  // segmentation editor/viewer viewports.
  // * Toggles visible when the 3D viewport have foreground focus.
  // * Toggles hidden when 2D viewports have foreground focus.
  
  const { id, label, icon } = button;
  const { viewportSpecificData, activeViewportIndex } = useSelector(redux.selectors.getActiveViewportData);

  return (<>
    <ToolbarButton key={id} id={id} label={label} icon={icon} 
      onClick={(evt) => toolbarClickCallback(button, evt)}
      isActive={isActive} />
  </>);
}


SonadorSegmentationViewer3DVToggleButton.propTypes = {
  parentContext: PropTypes.object.isRequired,
  toolbarClickCallback: PropTypes.func.isRequired,
  button: PropTypes.object.isRequired,
  activeButtons: PropTypes.array.isRequired,
  isActive: PropTypes.bool,
  className: PropTypes.string,
}


export { SonadorSegmentationViewer3DVToggleButton };