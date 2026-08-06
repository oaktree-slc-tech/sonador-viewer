// Viewer "More" menu control for permanently removing the open study (ohif-viewers#127).
//
// A CustomComponent rather than a plain command entry for two reasons: it is permission-gated on
// `remove`, and the removal has to raise the same blocking confirmation the study list uses, which
// is a React component driven by a hook. A toolbar command cannot own either.
//
// Once the removal is confirmed and the success notification is up, the tab closes: the viewer is
// open on a study that no longer exists, and every control in it now refers to nothing. The delay
// exists so the user reads the confirmation of what happened before the window goes away.

import React, { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import PropTypes from 'prop-types';

import { redux } from '@ohif/core';
import { ToolbarButton } from '@ohif/ui';

import useResourceAclPermissions from '@ohif/sonador-viewer/src/hooks/useResourceAclPermissions';
import RemoveResourceConfirm from '@ohif/sonador-viewer/src/components/studyList/StudyListNG/components/RemoveResourceConfirm/RemoveResourceConfirm';
import useRemoveResource from '@ohif/sonador-viewer/src/components/studyList/StudyListNG/hooks/useRemoveResource';


/** Long enough to read "Study removed", short enough not to feel like a hang. */
const CLOSE_TAB_DELAY_MS = 3500;


function RemoveStudyToolbarButton({ toolbarClickCallback, button, isActive }) {
  const { id, label, icon } = button;
  const { viewportSpecificData, activeViewportIndex } = useSelector(redux.selectors.getActiveViewportData);
  const { activeServer } = useSelector(redux.selectors.activeOhifServer);

  const vsd = (viewportSpecificData && viewportSpecificData[activeViewportIndex]) || {};
  const { StudyInstanceUID } = vsd;

  const { aclRemove } = useResourceAclPermissions({ server: activeServer, StudyInstanceUID });

  const [confirming, setConfirming] = useState(false);
  const { isRemoving, removeStudyResource } = useRemoveResource();

  const closeTimer = useRef(null);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  if (!StudyInstanceUID || !aclRemove) {
    return null;
  }

  const descriptor = {
    StudyInstanceUID,
    PatientName: vsd.PatientName,
    PatientID: vsd.PatientID,
    StudyDescription: vsd.StudyDescription,
    StudyDate: vsd.StudyDate,
    AccessionNumber: vsd.AccessionNumber,
  };

  const handleConfirm = async () => {
    const ok = await removeStudyResource(activeServer, descriptor);

    setConfirming(false);

    if (!ok) {
      // The failure notice is sticky and names the reason; the tab stays open so the user can
      // retry or read it.
      return;
    }

    closeTimer.current = setTimeout(() => {
      // window.close() only works for a tab this app opened -- which is how the study list opens
      // the viewer. Opened any other way (a pasted URL, a bookmark) the call is a silent no-op, so
      // fall back to the study list rather than leaving the user on a dead study.
      window.close();
      window.location.href = '/';
    }, CLOSE_TAB_DELAY_MS);
  };

  return (
    <>
      <ToolbarButton
        key={id}
        id={id}
        label={label}
        icon={icon}
        onClick={() => setConfirming(true)}
        isActive={isActive}
      />
      {confirming && (
        <RemoveResourceConfirm
          kind="study"
          descriptor={descriptor}
          isRemoving={isRemoving}
          onConfirm={handleConfirm}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}


RemoveStudyToolbarButton.propTypes = {
  toolbarClickCallback: PropTypes.func.isRequired,
  button: PropTypes.object.isRequired,
  isActive: PropTypes.bool,
};


export default RemoveStudyToolbarButton;
export { RemoveStudyToolbarButton, CLOSE_TAB_DELAY_MS };
