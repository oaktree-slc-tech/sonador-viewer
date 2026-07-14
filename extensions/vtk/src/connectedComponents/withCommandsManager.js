import React from 'react';

export default function withCommandsManager(Component, commandsManager = {}) {
  // Adds a scroll event to the viewport to synchronize the currently active slice

  return class WithCommandsManager extends React.Component {
    render() {

      return (
        <Component
          {...this.props}
          onScroll={(viewportIndex) =>
            commandsManager.runCommand('getVtkApiForViewportIndex', {
              index: viewportIndex,
            })
          }
        />
      );
    }
  };
}
