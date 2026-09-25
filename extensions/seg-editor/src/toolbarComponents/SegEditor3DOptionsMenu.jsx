import React, { useEffect, useRef, useState } from 'react';
import { ReactReduxContext, useSelector } from 'react-redux';
import PropTypes from 'prop-types';

import OHIF, { redux } from '@ohif/core';
import { ExpandableToolMenu, viewerbaseGetDisplaySet } from '@ohif/ui';

const { DisplaySetApi } = OHIF.display;

// displaySet attribute set while the 3D tab shows the Three.js editing canvas
const EDITING_ATTR = 'segEditor3dEditingEnabled';


function SegEditor3DOptionsMenu({ button, activeButtons = [], toolbarClickCallback }) {
  // The editor's "3D" toolbar menu (3D Volume, Surface). It controls the VTK 3D view, so it is
  // hidden while the 3D tab shows the Three.js editing canvas, which renders neither. Otherwise it
  // renders exactly as ToolbarRow renders a nested-button menu.

  const { viewportSpecificData, activeViewportIndex } = useSelector(redux.selectors.getActiveViewportData);
  const { displaySet } = viewerbaseGetDisplaySet(viewportSpecificData, activeViewportIndex);
  const displaySetInstanceUIDRef = useRef(displaySet?.displaySetInstanceUID);

  const _editing = () => !!DisplaySetApi.Instance.displaySetService
    .getDisplaySetByUID(displaySetInstanceUIDRef.current)?.[EDITING_ATTR];
  const [editing, setEditing] = useState(_editing);

  useEffect(() => {
    const subscription = DisplaySetApi.Instance.displaySetService.subscribe(
      DisplaySetApi.Instance.displaySetService.EVENTS.DISPLAY_SET_CHANGED,
      ({ displaySetInstanceUID, displaySet: changed }) => {
        if (displaySetInstanceUID == displaySetInstanceUIDRef.current) {
          setEditing(!!changed?.[EDITING_ATTR]);
        }
      });

    return () => subscription?.unsubscribe();
  }, []);

  if (editing) {
    return null;
  }

  const childButtons = (button.buttons || []).map(child => ({
    ...child,
    onClick: evt => toolbarClickCallback(child, evt),
  }));
  const activeCommand = childButtons.find(child => activeButtons.includes(child.id))?.id;

  return (
    <ReactReduxContext.Consumer>
      {ctx => (
        <ExpandableToolMenu
          label={button.label}
          icon={button.icon}
          buttons={childButtons}
          activeCommand={activeCommand}
          reduxStore={ctx?.store}
          toolbarClickCallback={toolbarClickCallback}
        />
      )}
    </ReactReduxContext.Consumer>
  );
}


SegEditor3DOptionsMenu.propTypes = {
  button: PropTypes.object.isRequired,
  activeButtons: PropTypes.array,
  toolbarClickCallback: PropTypes.func.isRequired,
};

export default SegEditor3DOptionsMenu;
