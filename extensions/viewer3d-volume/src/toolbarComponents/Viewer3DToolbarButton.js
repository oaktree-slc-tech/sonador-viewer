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
  const { id, label, icon } = button;

  // Determine which viewport is active
  const { viewportSpecificData, activeViewportIndex } = useSelector(redux.selectors.getActiveViewportData);

  // Should the 3D volume rendering button be visible
  const isVisible = isCTVolumeReconstructable(viewportSpecificData, activeViewportIndex);

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
