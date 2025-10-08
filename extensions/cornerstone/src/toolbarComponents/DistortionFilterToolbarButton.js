import _ from 'lodash';

import React, { useState, useCallback, useEffect } from 'react';
import { useSelector } from 'react-redux';
import PropTypes from 'prop-types';

import { redux, sonador } from '@ohif/core';
import { urlUtil } from '@ohif/core/src/utils';
import { ToolbarButton } from '@ohif/ui';


function DistortionFilterToolbarButton({ toolbarClickCallback, button, isActive }) {
  // Toolbar button which shows itself if a user is able to execute distortion filter tests

  const { id, label, icon } = button;
  const { viewportSpecificData, activeViewportIndex }  = useSelector(redux.selectors.getActiveViewportData);
  const { activeServer } = useSelector(redux.selectors.activeOhifServer);

  // State variable for managing toolbar visibility: initial state is undefined. Once the visibility state
  // has been determined (true/false), it will be set as a boolean.
  const [isVisible, setVisible] = useState(undefined);

  // Determine if the user has permissions to execute distortion tests: must be a super user
  // or have a `devices_list` permission from the server.
  const checkDistortionFilterAcl = useCallback(_.debounce((server) => {

    sonador.searchImageServerGroups(server, '', { devices_list: true })
      .then((res) => res.json())
      .then((res) => {

        // Set the menubar button visible if there is one gorup with device_list permissions
        setVisible(res.results?.length > 0);

      }).catch((err) => {
        console.error('Unable to retrieve device list groups from Sonador', err);
        setVisible(false);
      })
  }, 300), []);

  useEffect(() => {
    //useEffect helpers to prevent isVisible from being overwritten when the component re-renders
    if (activeServer && (activeServer.perms?.is_superuser || activeServer.perms?.devices_list)
      && activeServer.rootUrl && _.isUndefined(isVisible)) {

      // Check if user has permissions to execute device filter tests
      checkDistortionFilterAcl(activeServer)
    }

    return () => {
      checkDistortionFilterAcl.cancel(); // Cleanup debounce
    }
  }, [activeServer, isVisible, checkDistortionFilterAcl]);

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


DistortionFilterToolbarButton.propTypes = {
  parentContext: PropTypes.object.isRequired,
  toolbarClickCallback: PropTypes.func.isRequired,
  button: PropTypes.object.isRequired,
  activeButtons: PropTypes.array.isRequired,
  isActive: PropTypes.bool,
  className: PropTypes.string,
};


export default DistortionFilterToolbarButton;
export { DistortionFilterToolbarButton };