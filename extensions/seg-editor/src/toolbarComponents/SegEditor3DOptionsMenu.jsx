import React, { useEffect, useRef, useState } from 'react';
import { ReactReduxContext, useSelector } from 'react-redux';
import PropTypes from 'prop-types';

import OHIF, { redux } from '@ohif/core';
import { ExpandableToolMenu, viewerbaseGetDisplaySet } from '@ohif/ui';

const { DisplaySetApi } = OHIF.display;

// displaySet attribute set while the 3D tab shows the Three.js editing canvas
const EDITING_ATTR = 'segEditor3dEditingEnabled';


function SegEditor3DOptionsMenu({ button, activeButtons = [], toolbarClickCallback }) {
  // The editor's "3D" toolbar menu (3D Volume, Surface, Reset). The rendering toggles control the
  // VTK 3D view, so while the 3D tab shows the Three.js editing canvas (which renders neither)
  // only the buttons flagged `uiOptions.availableWhileEditing3d` are offered. Otherwise it renders
  // exactly as ToolbarRow renders a nested-button menu.

  const { viewportSpecificData, activeViewportIndex } = useSelector(redux.selectors.getActiveViewportData);
  const { displaySet } = viewerbaseGetDisplaySet(viewportSpecificData, activeViewportIndex);
  // The display set the menu follows: the active viewport's, kept while the viewport briefly has
  // none (a study reload), then the one it shows next
  const displaySetInstanceUIDRef = useRef(displaySet?.displaySetInstanceUID);
  if (displaySet && displaySet.displaySetInstanceUID !== displaySetInstanceUIDRef.current) {
    displaySetInstanceUIDRef.current = displaySet.displaySetInstanceUID;
  }
  const displaySetInstanceUID = displaySetInstanceUIDRef.current;

  const _editing = () => !!(typeof displaySetInstanceUIDRef.current === 'string'
    ? DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySetInstanceUIDRef.current) : undefined)?.[EDITING_ATTR];
  const [editing, setEditing] = useState(_editing);

  // A different display set: take its editing state
  useEffect(() => {
    setEditing(_editing());
  }, [displaySetInstanceUID]);

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

  const childButtons = (button.buttons || [])
    .filter(child => !editing || child.uiOptions?.availableWhileEditing3d)
    .map(child => ({
      ...child,
      onClick: evt => toolbarClickCallback(child, evt),
    }));
  if (!childButtons.length) {
    return null;
  }
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
