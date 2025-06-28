import { connect } from 'react-redux';
import _ from 'lodash';

import OHIF from '@ohif/core';

import VTKViewport from './VTKViewport';

const { setViewportActive, setViewportSpecificData } = OHIF.redux.actions;


const mapStateToProps = (state, ownProps) => {
  // Retrieve VTK viewport data kept in the Redux store
  let dataFromStore;

  if (state.extensions && state.extensions.vtk) {
    dataFromStore = state.extensions.vtk;
  }

  // If this is the active viewport, enable prefetching.
  const { viewportIndex } = ownProps;
  const isActive = viewportIndex === state.viewports.activeViewportIndex;
  const viewportLayout = state.viewports?.layout?.viewports?.[viewportIndex] ?? {};
  const pluginDetails = viewportLayout.vtk || {};

  return {
    activeViewportIndex: state.viewports.activeViewportIndex,
    layout: state.viewports.layout,
    isActive,
    ...pluginDetails,
    // Hopefully this doesn't break anything under the hood for this one
    // activeTool: activeButton && activeButton.command,
    ...dataFromStore,
    enableStackPrefetch: isActive,
  };
};


const mapDispatchToProps = (dispatch, ownProps) => {
  const { viewportIndex } = ownProps;

  return {
    setViewportActive: () => {
      dispatch(setViewportActive(viewportIndex));
    },

    setViewportSpecificData: (data) => {
      dispatch(setViewportSpecificData(viewportIndex, data));
    },
  };
};


const mergeProps = (propsFromState, propsFromDispatch, ownProps) => {
  // Merge properties from different sources to prevent collissions

  // Add hooks so that it is possible to trigger "afterCreation" callbacks from different sources.
  // afterCreation is the callback provided by the toolbar module.
  // componentAfterCreation is the callback passed in directly.
  const { afterCreation } = propsFromState;
  const { afterCreation: componentAfterCreation } = ownProps;

  return {
    ...propsFromState,
    ...propsFromDispatch,
    ..._.omit(ownProps, 'afterCreation'),
    /**
     * Our component sets up the underlying dom element on "componentDidMount"
     * for use with VTK.
     *
     * The onCreated prop passes back an Object containing many of the internal
     * components of the VTK scene. We can grab a reference to these here, to
     * make playing with VTK's native methods easier.
     *
     * A similar approach is taken with the Cornerstone extension.
     */
    onCreated: (api) => {
      // Store the API details for later
      //setViewportSpecificData({ vtkApi: api });

      if (afterCreation && typeof afterCreation === 'function') {
        afterCreation(api);
      }
      if (componentAfterCreation && _.isFunction(componentAfterCreation)) {
        componentAfterCreation(api);
      }
    },
  };
};

const ConnectedVTKViewport = connect(mapStateToProps, mapDispatchToProps, mergeProps)(VTKViewport);

export default ConnectedVTKViewport;
