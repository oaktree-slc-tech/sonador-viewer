import React from 'react';

export default function withCommandsManager(Component, commandsManager = {}) {
  // Add viewer event handlers which interface with the OHIF commands manager

  return class withCommandsManager extends React.Component {
    render() {
      return (
        <Component
          {...this.props}
          getStaticUrl={() => commandsManager.runCommand('getStaticUrl', {})}
        />
      );
    }
  };
}
