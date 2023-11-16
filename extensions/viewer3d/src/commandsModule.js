import { cornerstoneState } from '@ohif/extension-cornerstone';

export default function commandsModule({ servicesManager, commandsManager, appConfig }) {
  const actions = {
    getActiveViewportEnabledElement: ({ viewports }) => {
      // Retrieve the currently active viewport element
      const enabledElement = cornerstoneState.getEnabledElement(viewports.activeViewportIndex);
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
