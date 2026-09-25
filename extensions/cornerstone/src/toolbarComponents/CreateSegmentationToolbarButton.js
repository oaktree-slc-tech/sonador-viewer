// Viewer "More" menu item that creates a blank segmentation on the active series and opens the
// Segmentation Editor on it (ohif-viewers#143, FR-1). Only CT and MR series that can be viewed as
// a volume can be segmented in the editor, so the item is absent for anything else.

import React from 'react';
import { useSelector } from 'react-redux';
import PropTypes from 'prop-types';

import { redux } from '@ohif/core';
import { ToolbarButton, viewerbaseDisplaySetIsCTOrMRVolume } from '@ohif/ui';


function CreateSegmentationToolbarButton({ toolbarClickCallback, button, isActive }) {
  const { id, label, icon } = button;
  const { viewportSpecificData, activeViewportIndex } = useSelector(redux.selectors.getActiveViewportData);

  if (!viewerbaseDisplaySetIsCTOrMRVolume(viewportSpecificData, activeViewportIndex)) {
    return null;
  }

  return (
    <ToolbarButton
      key={id}
      id={id}
      label={label}
      icon={icon}
      onClick={evt => toolbarClickCallback(button, evt)}
      isActive={isActive}
    />
  );
}


CreateSegmentationToolbarButton.propTypes = {
  toolbarClickCallback: PropTypes.func.isRequired,
  button: PropTypes.object.isRequired,
  isActive: PropTypes.bool,
};


export default CreateSegmentationToolbarButton;
export { CreateSegmentationToolbarButton };
