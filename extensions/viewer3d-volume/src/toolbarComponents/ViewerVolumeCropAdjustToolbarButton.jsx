import React, { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import PropTypes from 'prop-types';

import OHIF, { redux } from '@ohif/core';
import { OverlayTrigger, ToolbarButton, Tooltip, viewerbaseGetDisplaySet } from '@ohif/ui';

import { CROP_ADJUST } from '../enums';

const { DisplaySetApi } = OHIF.display;


// Icon and help tag for each Adjust state (ohif-viewers#155 §3.3, §3.4)
const ADJUST_PRESENTATION = {
  [CROP_ADJUST.ACTIVE]: { icon: 'dot-circle', helpTag: 'Hide crop box' },
  [CROP_ADJUST.PAUSED]: { icon: 'dot-circle-paused', helpTag: 'Resume adjusting the crop box' },
  [CROP_ADJUST.OFF]: { icon: 'dot-circle', helpTag: 'Show and adjust crop box' },
};

const HELP_TAG_DELAY_MS = 500;


function _readAdjustState(displaySet) {
  return {
    visible: displaySet?.volumeCroppingEnabled === true,
    adjustState: displaySet?.volumeCropAdjustState || CROP_ADJUST.OFF,
  };
}


function ViewerVolumeCropAdjustToolbarButton({ toolbarClickCallback, button }) {
  // Toolbar button for the crop Adjust control. Hidden while cropping is off; otherwise the
  // highlight, icon, and help tag follow displaySet.volumeCropAdjustState. The wrapper is the
  // focusable control and help-tag anchor (ToolbarButton is a plain div with onClick only).

  const { id, label } = button;
  const { viewportSpecificData, activeViewportIndex } = useSelector(redux.selectors.getActiveViewportData);
  const { displaySet } = viewerbaseGetDisplaySet(viewportSpecificData, activeViewportIndex);
  const displaySetInstanceUID = displaySet?.displaySetInstanceUID;

  const { displaySetService } = DisplaySetApi.Instance;
  const [{ visible, adjustState }, setAdjustState] = useState(
    () => _readAdjustState(displaySetService.getDisplaySetByUID(displaySetInstanceUID)));

  useEffect(() => {
    setAdjustState(_readAdjustState(displaySetService.getDisplaySetByUID(displaySetInstanceUID)));

    const subscription = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SET_CHANGED, ({ displaySetInstanceUID: uid, displaySet: _ds }) => {
        if (uid == displaySetInstanceUID) {
          setAdjustState(_readAdjustState(_ds));
        }
      });

    return () => subscription?.unsubscribe();
  }, [displaySetInstanceUID]);

  // A state change dismisses the help tag (and cancels a pending one) without remounting, so
  // keyboard focus stays on the control
  const helpTagRef = useRef(null);
  const previousAdjustState = useRef(adjustState);
  useEffect(() => {
    if (previousAdjustState.current !== adjustState) {
      previousAdjustState.current = adjustState;
      helpTagRef.current?.handleDelayedHide();
    }
  }, [adjustState]);

  if (!visible) {
    return null;
  }

  const { icon, helpTag } = ADJUST_PRESENTATION[adjustState] || ADJUST_PRESENTATION[CROP_ADJUST.OFF];
  const isActive = adjustState == CROP_ADJUST.ACTIVE;

  // Native button activation: Enter on keydown, Space on keyup
  const onKeyDown = (evt) => {
    if (evt.key === 'Enter' && !evt.repeat) {
      evt.preventDefault();
      toolbarClickCallback(button, evt);
    } else if (evt.key === ' ') {
      evt.preventDefault();
    }
  };
  const onKeyUp = (evt) => {
    if (evt.key === ' ') {
      evt.preventDefault();
      toolbarClickCallback(button, evt);
    }
  };

  return (
    <OverlayTrigger
      ref={helpTagRef}
      placement="bottom"
      delayShow={HELP_TAG_DELAY_MS}
      overlay={<Tooltip placement="bottom" className="in" id={`${id}-help-tag`}>{helpTag}</Tooltip>}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-pressed={isActive}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        style={{ float: 'left' }}
      >
        <ToolbarButton
          id={id}
          label={label}
          icon={icon}
          isActive={isActive}
          onClick={(evt) => toolbarClickCallback(button, evt)}
        />
      </div>
    </OverlayTrigger>
  );
}


ViewerVolumeCropAdjustToolbarButton.propTypes = {
  toolbarClickCallback: PropTypes.func.isRequired,
  button: PropTypes.object.isRequired,
};


export default ViewerVolumeCropAdjustToolbarButton;
