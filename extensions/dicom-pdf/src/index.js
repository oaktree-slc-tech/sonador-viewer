import React from 'react';

import { version } from '../package.json';
import OHIFDicomPDFSopClassHandler from './OHIFDicomPDFSopClassHandler.js';

const Component = React.lazy(() => {
  return import('./ConnectedOHIFDicomPDFViewer');
});

const ConnectedOHIFDicomPDFViewer = (props) => {
  return (
    <React.Suspense fallback={<div>Loading...</div>}>
      <Component {...props} />
    </React.Suspense>
  );
};

export default {
  /**
   * Only required property. Should be a unique value across all extensions.
   */
  id: 'pdf',
  version,
  getSopClassHandlerModule() {
    return OHIFDicomPDFSopClassHandler;
  },
  getViewportModule() {
    return ConnectedOHIFDicomPDFViewer;
  },
};
