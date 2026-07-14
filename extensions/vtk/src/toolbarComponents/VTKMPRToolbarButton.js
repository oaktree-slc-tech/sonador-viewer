import React from 'react';
import { useSelector } from 'react-redux';
import PropTypes from 'prop-types';

import { redux } from '@ohif/core';
import { ToolbarButton, viewerbaseDisplaySetReconstructable } from '@ohif/ui';


export default function VTKMPRToolbarButton({ toolbarClickCallback, button, isActive }) {
  // Toolbar button which hides itself if a volume cannot be 3D reconstructed

  const { id, label, icon } = button;
  const { viewportSpecificData, activeViewportIndex } = useSelector(redux.selectors.getActiveViewportData);

  const isVisible = viewerbaseDisplaySetReconstructable(viewportSpecificData, activeViewportIndex);

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


VTKMPRToolbarButton.propTypes = {
  parentContext: PropTypes.object.isRequired,
  toolbarClickCallback: PropTypes.func.isRequired,
  button: PropTypes.object.isRequired,
  activeButtons: PropTypes.array.isRequired,
  isActive: PropTypes.bool,
  className: PropTypes.string,
};

export { VTKMPRToolbarButton };
