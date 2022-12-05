import React from 'react';
import { useSelector } from 'react-redux';
import PropTypes from 'prop-types';
import { ToolbarButton, viewerbaseDisplaySetReconstructable } from '@ohif/ui';
import { utils } from '@ohif/core';

const { studyMetadataManager } = utils;

let isVisible = true;

function VTKMPRToolbarButton({
  parentContext,
  toolbarClickCallback,
  button,
  activeButtons,
  isActive,
  className,
}) {
  const { id, label, icon } = button;
  const { viewportSpecificData, activeViewportIndex } = useSelector((state) => {
    const { viewports = {} } = state;
    const { viewportSpecificData, activeViewportIndex } = viewports;

    return {
      viewportSpecificData,
      activeViewportIndex,
    };
  });

  isVisible = viewerbaseDisplaySetReconstructable(
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

VTKMPRToolbarButton.propTypes = {
  parentContext: PropTypes.object.isRequired,
  toolbarClickCallback: PropTypes.func.isRequired,
  button: PropTypes.object.isRequired,
  activeButtons: PropTypes.array.isRequired,
  isActive: PropTypes.bool,
  className: PropTypes.string,
};

export { VTKMPRToolbarButton };
