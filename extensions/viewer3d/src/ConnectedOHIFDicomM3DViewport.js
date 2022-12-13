import _ from 'lodash';
import { connect } from 'react-redux';

import OHIF from '@ohif/core';
import OHIFDicomM3DViewport from './OHIFDicomM3DViewport.js';

const { setViewportActive, setViewportSpecificData } = OHIF.redux.actions;

const mapStateToProps = (state, ownProps) => {
  // Retrieve global viewport properties for volume rendering viewport

  // Determine if viewport is active
  const { viewportIndex } = ownProps;
  const isActive = viewportIndex == state.viewports.activeViewportIndex;

  const cprops = {
    activeViewportIndex: state.viewports.activeViewportIndex,
    isActive,
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
  // Merge properties sources to prevent collissions
  const props = {
    ...propsFromState,
    ...propsFromDispatch,
    ...ownProps,
  };
  return props;
};

const ConnectedOHIFDicomM3DViewport = connect(
  mapStateToProps,
  mapDispatchToProps,
  mergeProps
)(OHIFDicomM3DViewport);

export default ConnectedOHIFDicomM3DViewport;
