import React from 'react';

import { utils } from '@ohif/core';
import { cornerstoneState } from '@ohif/extension-cornerstone';

const { studyMetadataManager } = utils;

export default function commandsModule({
  servicesManager,
  commandsManager,
  appConfig,
}) {
  // Retrieve the available commands for the module
  console.log('Get commands module: ', appConfig);

  const actions = {
    getActiveViewportEnabledElement: ({ viewports }) => {
      // Retrieve the currently active viewport element
      const enabledElement = cornerstoneState.getEnabledElement(
        viewports.activeViewportIndex
      );
      return enabledElement;
    },
    getStaticUrl: () => {
      // Retrieve the static file URL from the app configuration
      return (appConfig || {}).staticUrl;
    },
  };

  const definitions = {
    getActiveViewportEnabledElement: {
      commandFn: actions.getActiveViewportEnabledElement,
      storeContexts: ['viewports'],
      options: {},
    },
    getStaticUrl: {
      commandFn: actions.getStaticUrl,
      storeContexts: ['viewports'],
      options: {},
    },
  };

  return {
    actions,
    definitions,
    defaultContext: 'VIEWER',
  };
}
