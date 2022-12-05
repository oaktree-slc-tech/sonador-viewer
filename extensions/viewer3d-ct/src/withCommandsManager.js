import React from 'react';

export default function withCommandsManager(Component, commandsManager = {}) {
  // Add viewer event handlers to the viewport to synchronize volumes with active slices and window controls

  return class WithCommandsManager extends React.Component {
    render() {
      return <Component {...this.props} />;
    }
  };
}
