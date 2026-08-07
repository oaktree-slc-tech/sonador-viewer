import React from 'react';
import { connect } from 'react-redux';

import OHIF, { ViewportRefsProvider } from '@ohif/core';

const { setViewportActive } = OHIF.redux.actions;

const Component = React.lazy(() => {
  return import('../viewports/OHIFCornerstonePdfViewport');
});


const OHIFDicomPDFViewportShell = (props) => {
  // Suspense boundary and viewport ref registry for the lazily loaded PDF viewport
  return (
    <React.Suspense fallback={<div>Loading...</div>}>
      <ViewportRefsProvider>
        <Component {...props} />
      </ViewportRefsProvider>
    </React.Suspense>
  );
};


const mapStateToProps = (state, ownProps) => {
  // Retrieve global viewport properties for the PDF document viewport

  // Determine if viewport is active
  const { viewportIndex } = ownProps;
  const { activeViewportIndex } = state.viewports;

  return {
    activeViewportIndex,
    isActive: viewportIndex === activeViewportIndex,
  };
};


const mapDispatchToProps = (dispatch, ownProps) => {
  // Create actions to modify global state from component
  const { viewportIndex } = ownProps;

  return {
    setViewportActive: () => {
      dispatch(setViewportActive(viewportIndex));
    },
  };
};


const ConnectedOHIFDicomPDFViewport = connect(mapStateToProps, mapDispatchToProps)(OHIFDicomPDFViewportShell);

export default ConnectedOHIFDicomPDFViewport;
