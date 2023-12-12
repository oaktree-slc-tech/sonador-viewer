import React from 'react';

export default function withCommandsManager(Component, commandsManager = {}) {
  // Add viewer event handlers which interface with the OHIF commands manager

  return (props) => {
    return <Component {...props} getStaticUrl={() => commandsManager.runCommand('getStaticUrl', {})} />;
  };
}
