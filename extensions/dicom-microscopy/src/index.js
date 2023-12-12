import React from 'react';

import dicomMicroscopyPackage from '../package.json';

import DicomMicroscopySopClassHandler from './DicomMicroscopySopClassHandler.js';

const Component = React.lazy(() => {
  return import('./DicomMicroscopyViewport');
});

export default {
  /**
   * Only required property. Should be a unique value across all extensions.
   */
  id: 'microscopy',
  version: dicomMicroscopyPackage.version,

  getViewportModule({ servicesManager }) {
    return (props) => {
      return (
        <React.Suspense fallback={<div>Loading...</div>}>
          <Component {...props} servicesManager={servicesManager} />
        </React.Suspense>
      );
    };
  },
  getSopClassHandlerModule() {
    return DicomMicroscopySopClassHandler;
  },
};
