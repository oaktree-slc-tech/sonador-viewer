import _ from 'lodash';

import React, { useEffect, useState, useRef } from 'react';
import { useSelector } from 'react-redux';
import PropTypes from 'prop-types';

import OHIF, { redux } from '@ohif/core';
import { ToolbarButton, viewerbaseGetDisplaySet } from '@ohif/ui';

const { DisplaySetApi } = OHIF.display;


function DisplaySetAttributeActiveToolbarButton({
		toolbarClickCallback, button, isActiveDisplaySetAttr, isActiveDefault = false,
		isActiveDisplaySetValue, visibleDisplaySetAttr,
	}) {
	// Toolbar button which toggles active or inactive depending on the state of the specified isActiveDisplaySetAttr
	// of the current displaySet.
	//
	// When the optional isActiveDisplaySetValue is provided, the button is active while the
	// attribute EQUALS that value (mode selectors sharing one attribute, e.g. volumeViewerToolMode);
	// otherwise active follows the attribute's truthiness. When the optional visibleDisplaySetAttr
	// is provided, the button is only rendered while that displaySet attribute is truthy
	// (three-state widgets: hidden / inactive / active). All attributes update from the same
	// DISPLAY_SET_CHANGED subscription. Consumers that pass neither option render exactly as before.

	const { id, label, icon } = button;
	const { viewportSpecificData, activeViewportIndex } = useSelector(redux.selectors.getActiveViewportData);
	const { displaySet: _ds0 } = viewerbaseGetDisplaySet(viewportSpecificData, activeViewportIndex);
	const displaySetInstanceUIDRef = useRef(_ds0.displaySetInstanceUID);

	const _resolveActive = (attrValue) => {
		// Resolve the active state from the attribute value (default when the attribute is unset)
		if (_.isNil(attrValue)) {
			return isActiveDefault;
		}
		return _.isNil(isActiveDisplaySetValue) ? attrValue : attrValue == isActiveDisplaySetValue;
	};

	// Retrieve current displayset value (or use default if it is not defined)
	const _ds = DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySetInstanceUIDRef.current);
	const _active = _resolveActive(_ds?.[isActiveDisplaySetAttr]);
	const _visible = _.isNil(visibleDisplaySetAttr) ? true : !!_ds?.[visibleDisplaySetAttr];

	//  Toggle button active/visible state based on the tracked attributes of the displaySet
	const [isActive, setActive] = useState(_active);
	const [isVisible, setVisible] = useState(_visible);
	useEffect(() => {

		// displaySet API: displaySet changed
    const displaysets_dataupdate = DisplaySetApi.Instance.displaySetService.subscribe(
      DisplaySetApi.Instance.displaySetService.EVENTS.DISPLAY_SET_CHANGED, ({ displaySetInstanceUID, displaySet }) => {

      	if (displaySetInstanceUID == displaySetInstanceUIDRef.current) {
      		setActive(_resolveActive(displaySet[isActiveDisplaySetAttr]));
      		if (!_.isNil(visibleDisplaySetAttr)) {
      			setVisible(!!displaySet[visibleDisplaySetAttr]);
      		}
      	}
      });

		return () => {

			// Unsubscribe from data updates
			displaysets_dataupdate?.unsubscribe();
		}
	});

	if (!isVisible) {
		return null;
	}

	return (
    <ToolbarButton
      key={id}
      id={id}
      label={label}
      icon={icon}
      onClick={(evt) => toolbarClickCallback(button, evt)}
      isActive={isActive}
    />
  );
}


DisplaySetAttributeActiveToolbarButton.propTypes = {
  parentContext: PropTypes.object.isRequired,
  toolbarClickCallback: PropTypes.func.isRequired,
  button: PropTypes.object.isRequired,
  activeButtons: PropTypes.array.isRequired,
  isActiveDisplaySetAttr: PropTypes.string.isRequired,
  isActiveDefault: PropTypes.bool,
  isActiveDisplaySetValue: PropTypes.any,
  visibleDisplaySetAttr: PropTypes.string,
  className: PropTypes.string,
};

export default DisplaySetAttributeActiveToolbarButton;