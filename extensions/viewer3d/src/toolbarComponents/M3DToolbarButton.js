import React from 'react';
import { useSelector } from 'react-redux';
import PropTypes from 'prop-types';

import { redux } from '@ohif/core';
import { ToolbarButton, viewerbaseGetDisplaySet } from '@ohif/ui';


const _isM3DModality = (viewportSpecificData = {}, activeViewportIndex) => {
  // Determine if the active viewport is a 3D file. TODO: The file check in this method uses
  // the modality (M3D) to determine if it is a 3D file. A more rigorous check
  // maybe uses the encapsulated mimetype might be a better option.

  try {
    const { displaySet } = viewerbaseGetDisplaySet(viewportSpecificData, activeViewportIndex);

    // Check if the modality is M3D
    return displaySet && displaySet.Modality === 'M3D';
  } catch (err) {
    console.error(err);
  }

  return false;
};


const _isM3DAnimated = (viewportSpecificData = {}, activeViewportIndex) => {
  // Determine if the active viewport supports M3D animations
  try {
    const vdata = viewportSpecificData[activeViewportIndex] || {};
    const { m3d } = vdata;

    return vdata && (m3d || {}).animations;
  } catch (err) {
    console.error(err);
  }

  return false;
};


function M3DToolbarButton({ toolbarClickCallback, button, isActive, className }) {
  const { id, label, icon } = button;
  const { viewportSpecificData, activeViewportIndex } = useSelector(redux.selectors.getActiveViewportData);

  // Should the M3D button be visible
  const isVisible = _isM3DModality(viewportSpecificData, activeViewportIndex);

  return (
    <>
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
    </>
  );
}


M3DToolbarButton.propTypes = {
  parentContext: PropTypes.object.isRequired,
  toolbarClickCallback: PropTypes.func.isRequired,
  button: PropTypes.object.isRequired,
  activeButtons: PropTypes.oneOfType([PropTypes.object.isRequired, PropTypes.array.isRequired]).isRequired,
  isActive: PropTypes.bool,
  className: PropTypes.string,
};

function M3DAnimationControlToolbarButton({ toolbarClickCallback, button, isActive, className }) {
  const { id, label, icon } = button;
  const { viewportSpecificData, activeViewportIndex } = useSelector(redux.selectors.getActiveViewportData);

  // Should the M3D button be visible
  const isVisible = _isM3DAnimated(viewportSpecificData, activeViewportIndex);

  return (
    <>
      {isVisible && (
        <ToolbarButton
          key={id}
          id={id}
          className={className}
          label={label}
          icon={icon}
          onClick={(evt) => toolbarClickCallback(button, evt)}
          isActive={isActive}
        />
      )}
    </>
  );
}


M3DAnimationControlToolbarButton.propTypes = {
  parentContext: PropTypes.object.isRequired,
  toolbarClickCallback: PropTypes.func.isRequired,
  button: PropTypes.object.isRequired,
  activeButtons: PropTypes.oneOfType([PropTypes.object.isRequired, PropTypes.array.isRequired]).isRequired,
  isActive: PropTypes.bool,
  className: PropTypes.string,
};


export default M3DToolbarButton;
export { M3DToolbarButton, M3DAnimationControlToolbarButton };
