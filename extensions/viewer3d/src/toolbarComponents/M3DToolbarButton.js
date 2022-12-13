import _ from 'lodash';

import React from 'react';
import { useSelector } from 'react-redux';
import PropTypes from 'prop-types';

import { utils, redux } from '@ohif/core';
import { ToolbarButton, viewerbaseGetDisplaySet } from '@ohif/ui';

const { studyMetadataManager } = utils;

const _isM3DModality = (viewportSpecificData = {}, activeViewportIndex) => {
  // Determine if the active viewport is a 3D file. TODO: The file check in this method uses
  // the modality (M3D) to determine if it is a 3D file. A more rigorous check
  // maybe uses the encapsulated mimetype might be a better option.

  try {
    const { study, displaySet } = viewerbaseGetDisplaySet(
      viewportSpecificData,
      activeViewportIndex
    );

    // Check if the modality is M3D
    return displaySet && displaySet.Modality == 'M3D';
  } catch (err) {}

  return false;
};

const _isM3DAnimated = (viewportSpecificData = {}, activeViewportIndex) => {
  // Determine if the active viewport supports M3D animations
  try {
    const vdata = viewportSpecificData[activeViewportIndex] || {};
    const { m3d } = vdata;

    return vdata && (m3d || {}).animations;
  } catch (err) {}

  return false;
};

function M3DToolbarButton({
  parentContext,
  toolbarClickCallback,
  button,
  activeButtons,
  isActive,
  className,
}) {
  const { id, label, icon } = button;
  const { viewportSpecificData, activeViewportIndex } = useSelector(
    redux.selectors.getActiveViewportData
  );

  // Should the M3D button be visible
  const isVisible = _isM3DModality(viewportSpecificData, activeViewportIndex);

  return (
    <React.Fragment>
      {isVisible && (
        <ToolbarButton
          key={id}
          className={className}
          label={label}
          icon={icon}
          onClick={(evt) => toolbarClickCallback(button, evt)}
          isActive={isActive}
        />
      )}
    </React.Fragment>
  );
}

M3DToolbarButton.propTypes = {
  parentContext: PropTypes.object.isRequired,
  toolbarClickCallback: PropTypes.func.isRequired,
  button: PropTypes.object.isRequired,
  activeButtons: PropTypes.object.isRequired,
  activeButtons: PropTypes.array.isRequired,
  isActive: PropTypes.bool,
  className: PropTypes.string,
};

function M3DAnimationControlToolbarButton({
  parentContext,
  toolbarClickCallback,
  button,
  activeButtons,
  isActive,
  className,
}) {
  const { id, label, icon } = button;
  const { viewportSpecificData, activeViewportIndex } = useSelector(
    redux.selectors.getActiveViewportData
  );

  // Should the M3D button be visible
  const isVisible = _isM3DAnimated(viewportSpecificData, activeViewportIndex);

  return (
    <React.Fragment>
      {isVisible && (
        <ToolbarButton
          key={id}
          className={className}
          label={label}
          icon={icon}
          onClick={(evt) => toolbarClickCallback(button, evt)}
          isActive={isActive}
        />
      )}
    </React.Fragment>
  );
}

M3DAnimationControlToolbarButton.propTypes = {
  parentContext: PropTypes.object.isRequired,
  toolbarClickCallback: PropTypes.func.isRequired,
  button: PropTypes.object.isRequired,
  activeButtons: PropTypes.object.isRequired,
  activeButtons: PropTypes.array.isRequired,
  isActive: PropTypes.bool,
  className: PropTypes.string,
};

export default M3DToolbarButton;
export { M3DToolbarButton, M3DAnimationControlToolbarButton };
