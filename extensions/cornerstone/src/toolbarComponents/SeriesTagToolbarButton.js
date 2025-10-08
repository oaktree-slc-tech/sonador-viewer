import _ from 'lodash';

import React, { useState, useCallback, useEffect } from 'react';
import { useSelector } from 'react-redux';
import PropTypes from 'prop-types';

import { redux, sonador } from '@ohif/core';
import { urlUtil } from '@ohif/core/src/utils';
import { ToolbarButton } from '@ohif/ui';


function SeriesTagToolbarButton({ toolbarClickCallback, button, isActive }) {
	//  Toolbar button which shows itself if a user is able to tag a series

	const { id, label, icon } = button;
	const { viewportSpecificData, activeViewportIndex }	 = useSelector(redux.selectors.getActiveViewportData);
	const { activeServer } = useSelector(redux.selectors.activeOhifServer);

	// State variable for managing toolbar visibility: initial state is undefined. Once the visibility state
	// has been determined (true/false), it will be set as a boolean.
	const [isVisible, setVisible] = useState(undefined);

	// Determine if the user has permissions to create series labels: must be a super user
	// or have an upload permission AND be a member of at least one group where tags are enabled.
	const checkTagPermissions = useCallback(_.debounce((server) => {

		sonador.searchImageServerGroups(server, '', { tag: true })
			.then((res) => res.json())
			.then((res) => {

				// Set menubar button visible if there is at least one group with tag permissions
				setVisible(res.results?.length > 0);
				
			}).catch((err) => {
				console.error('Unable to retrieve tag groups from Sonador', err);
				setVisible(false);
			})
	}, 300), []);

	useEffect(() => {
		// useEffect helps to prevent isVisible from being overwritten when the component re-renders.

		if (activeServer && (activeServer.perms?.is_superuser || activeServer.perms?.upload)
			&& activeServer.rootUrl && _.isUndefined(isVisible)) {

			// Check if user has permissions to add tags to series
			checkTagPermissions(activeServer);
		}

		return () => {
			checkTagPermissions.cancel(); // Cleanup debounce
		}
	}, [activeServer, isVisible, checkTagPermissions]);

	return (<>
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
	</>);
}


SeriesTagToolbarButton.propTypes = {
  parentContext: PropTypes.object.isRequired,
  toolbarClickCallback: PropTypes.func.isRequired,
  button: PropTypes.object.isRequired,
  activeButtons: PropTypes.array.isRequired,
  isActive: PropTypes.bool,
  className: PropTypes.string,
};


export default SeriesTagToolbarButton;
export { SeriesTagToolbarButton };