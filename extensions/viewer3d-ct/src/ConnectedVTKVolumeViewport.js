import _ from 'lodash';
import { connect } from 'react-redux';

import OHIF from '@ohif/core';
import VTKVolumeViewport from './VTKVolumeViewport.js';

const { setViewportActive, setViewportSpecificData } = OHIF.redux.actions;

const mapStateToProps = (state, ownProps) => {
  // Retrieve global viewport properties for volume rendering viewport
  let dataFromStore;

  // Retrieve parsed 3D volume viewer options from data store
  if (state.extensions && state.extensions.viewer3dct) {
    dataFromStore = state.extensions.viewer3dct;
  }

  // If viewport is active, enable prefectching.
  const { viewportIndex } = ownProps;
  const isActive = viewportIndex === state.viewports.activeViewportIndex;
  const viewportLayout = state.viewports.layout.viewports[viewportIndex];
  const pluginDetails = viewportLayout.viewer3dct || viewportLayout.vtk || {};

  const cprops = {
    activeViewportIndex: state.viewports.activeViewportIndex,
    layout: state.viewports.layout,
    isActive,
    ...pluginDetails,
    ...dataFromStore,
    enableStackPrefetch: isActive,
  };
  return cprops;
};

const mapDispatchToProps = (dispatch, ownProps) => {
  // Create actions to modify global state from component
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

  const props = {
    ...propsFromState,
    ...propsFromDispatch,
    ..._.omit(ownProps, 'afterCreation'),
    /**
     * The 3D viewer compoennt sets up the underlying DOM element on "componentDidMount"
     * for use with VTK. The onCreated prop passes back an Object contining many of the internal
     * components of the VTK scene. This method passes a reference to the component
     * to make it easier to integrate with VTK's native methods. The Cornerstone extension
     * uses a similar approach.
     */
    onCreated: (api) => {
      // Store VTK API details
      if (afterCreation && typeof afterCreation == 'function') {
        afterCreation(api);
      }
      if (componentAfterCreation && _.isFunction(componentAfterCreation)) {
        componentAfterCreation(api);
      }
    },
  };
  return props;
};

const ConnectedVTKVolumeViewport = connect(
  mapStateToProps,
  mapDispatchToProps,
  mergeProps
)(VTKVolumeViewport);

export default ConnectedVTKVolumeViewport;
