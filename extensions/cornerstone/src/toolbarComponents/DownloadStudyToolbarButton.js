// Viewer "More" menu control for exporting the open study as a .zip (ohif-viewers#127).
//
// A CustomComponent rather than a plain toolbar entry purely so it can be permission-gated: the
// item is absent for a user without `view` on the study, rather than rendered and then failing.
// Follows the LocalCacheToolbarButton pattern.

import React from 'react';
import { useSelector } from 'react-redux';
import PropTypes from 'prop-types';

import { redux } from '@ohif/core';
import { ToolbarButton } from '@ohif/ui';
import useResourceAclPermissions from '@ohif/sonador-viewer/src/hooks/useResourceAclPermissions';


function DownloadStudyToolbarButton({ toolbarClickCallback, button, isActive }) {
  const { id, label, icon } = button;
  const { viewportSpecificData, activeViewportIndex } = useSelector(redux.selectors.getActiveViewportData);
  const { activeServer } = useSelector(redux.selectors.activeOhifServer);

  const { StudyInstanceUID } = (viewportSpecificData && viewportSpecificData[activeViewportIndex]) || {};

  const { aclView } = useResourceAclPermissions({ server: activeServer, StudyInstanceUID });

  if (!StudyInstanceUID || !aclView) {
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


DownloadStudyToolbarButton.propTypes = {
  toolbarClickCallback: PropTypes.func.isRequired,
  button: PropTypes.object.isRequired,
  isActive: PropTypes.bool,
};


export default DownloadStudyToolbarButton;
export { DownloadStudyToolbarButton };
