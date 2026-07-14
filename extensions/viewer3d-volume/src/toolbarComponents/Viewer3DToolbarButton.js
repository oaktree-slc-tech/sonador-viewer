import React from 'react';
import { useSelector } from 'react-redux';
import PropTypes from 'prop-types';

import { redux } from '@ohif/core';
import { ToolbarButton, viewerbaseDisplaySetReconstructable, viewerbaseGetDisplaySet } from '@ohif/ui';


const isCTVolumeReconstructable = (viewportSpecificData = {}, activeViewportIndex) => {
  // Determine if the series instance supports 3D volume reconstruction

  try {
    // Determine if the displayset supports 3D reconstruction
    const isVisible = viewerbaseDisplaySetReconstructable(viewportSpecificData, activeViewportIndex);

    if (isVisible) {
      const { displaySet } = viewerbaseGetDisplaySet(viewportSpecificData, activeViewportIndex);

      // Check if the modality is CT
      return displaySet && (displaySet.Modality === 'CT' || displaySet.Modality === 'MR');
    }
  } catch (err) {
    console.error('Unable to retrieve study or displayset due to an error.', err);
  }

  return false;
};


function Viewer3DCTToolbarButton({ toolbarClickCallback, button, isActive }) {
  // Toolbar button which is displayed if a series can be loaded to the 3D viewer. To be loaded, the series
  // must be 3D reconstructabble. (Note: the button is only visible when there is a single row and column in the 
  // viewport grid manager.)

  const { id, label, icon } = button;

  // Determine which viewport is active
  const { numColumns = 0, numRows = 0} = useSelector((state) => state.viewports);
  const { viewportSpecificData, activeViewportIndex } = useSelector(redux.selectors.getActiveViewportData);

  // Should the 3D volume rendering button be visible
  const isVisible = numColumns == 1 && numRows == 1
    && isCTVolumeReconstructable(viewportSpecificData, activeViewportIndex);

  return (
    <>
      {isVisible && (
        <ToolbarButton
          key={id}
          id={id}
          label={label}
          icon={icon}
          onClick={(evt) => toolbarClickCallback(button, evt)}
          isActive={isActive}
        />
      )}
    </>
  );
}


Viewer3DCTToolbarButton.propTypes = {
  parentContext: PropTypes.object.isRequired,
  toolbarClickCallback: PropTypes.func.isRequired,
  button: PropTypes.object.isRequired,
  activeButtons: PropTypes.array.isRequired,
  isActive: PropTypes.bool,
  className: PropTypes.string,
};

export default Viewer3DCTToolbarButton;
