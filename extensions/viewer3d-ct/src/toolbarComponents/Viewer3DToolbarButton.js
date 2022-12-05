import React from 'react';
import { useSelector } from 'react-redux';
import PropTypes from 'prop-types';
import {
  ToolbarButton,
  viewerbaseGetDisplaySet,
  viewerbaseDisplaySetReconstructable,
} from '@ohif/ui';
import { utils } from '@ohif/core';

const { studyMetadataManager } = utils;

let isVisible = false;

const _isCTVolumeReconstructable = (
  viewportSpecificData = {},
  activeViewportIndex
) => {
  // Determine if the series instance supports 3D volume reconstruction
  try {
    // Determine if the displayset supports 3D reconstruction
    let isVisible = viewerbaseDisplaySetReconstructable(
      viewportSpecificData,
      activeViewportIndex
    );

    if (isVisible) {
      const { study, displaySet } = viewerbaseGetDisplaySet(
        viewportSpecificData,
        activeViewportIndex
      );

      // Check if the modality is CT
      return displaySet && displaySet.Modality == 'CT';
    }
  } catch (err) {
    console.error(
      'Unable to retrieve study or displayset due to an error.',
      err
    );
  }

  return false;
};

function Viewer3DCTToolbarButton({
  parentContext,
  toolbarClickCallback,
  button,
  activeButtons,
  isActive,
  className,
}) {
  const { id, label, icon } = button;

  // Determine which viewport is active
  const { viewportSpecificData, activeViewportIndex } = useSelector((state) => {
    const { viewports = {} } = state;
    const { viewportSpecificData, activeViewportIndex } = viewports;

    return {
      viewportSpecificData,
      activeViewportIndex,
    };
  });

  // Should the 3D viewer button be visible
  isVisible = _isCTVolumeReconstructable(
    viewportSpecificData,
    activeViewportIndex
  );

  return (
    <React.Fragment>
      {isVisible && (
        <ToolbarButton
          key={id}
          label={label}
          icon={icon}
          onClick={(evt) => toolbarClickCallback(button, evt)}
          isActive={isActive}
        />
      )}
    </React.Fragment>
  );
}

Viewer3DCTToolbarButton.propTypes = {
  parentContext: PropTypes.object.isRequired,
  toolbarClickCallback: PropTypes.func.isRequired,
  button: PropTypes.object.isRequired,
  activeButtons: PropTypes.object.isRequired,
  activeButtons: PropTypes.array.isRequired,
  isActive: PropTypes.bool,
  className: PropTypes.string,
};

export default Viewer3DCTToolbarButton;
