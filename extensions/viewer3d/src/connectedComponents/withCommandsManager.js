import React from 'react';

export default function withCommandsManager(Component, commandsManager = {}, extraProps = {}) {
  // Add viewer event handlers which interface with the OHIF commands manager. Additional
  // extension-scope props (e.g. servicesManager) may be injected through extraProps.

  return (props) => {
    return <Component {...props} {...extraProps} getStaticUrl={() => commandsManager.runCommand('getStaticUrl', {})} />;
  };
}
