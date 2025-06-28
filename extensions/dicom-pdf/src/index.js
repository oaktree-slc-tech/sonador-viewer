import _ from 'lodash';
import React from 'react';

import OHIF, { ViewportRefsProvider } from '@ohif/core';

import dicomPdfVersion from '../package.json';

import OHIFDicomPDFSopClassHandler from './OHIFDicomPDFSopClassHandler.js';

const Component = React.lazy(() => {
  return import('./viewports/OHIFCornerstonePdfViewport');
});


const ConnectedOHIFDicomPDFViewer = (props) => {
  return (
    <React.Suspense fallback={<div>Loading...</div>}>
      <ViewportRefsProvider>
        <Component {...props} />
      </ViewportRefsProvider>
    </React.Suspense>
  );
};


export default {
  /**
   * Only required property. Should be a unique value across all extensions.
   */
  id: 'pdf',
  version: dicomPdfVersion.version,
  getSopClassHandlerModule({ extensionManager, }) {    
    // SOP Class Handler Module for PDF

    // Extension manager to the list of arguments for creating displaySets
    const OHIFDicomOhifNgPDFSopClassHandler = _.extend({}, OHIFDicomPDFSopClassHandler, {
      getDisplaySetFromSeries: (...args) => {
        return OHIFDicomPDFSopClassHandler.getDisplaySetFromSeries(extensionManager, ...args);
      }
    });

    return OHIFDicomOhifNgPDFSopClassHandler;
  },
  getViewportModule({ servicesManager, commandsManager, extensionManager }) {

    return (props) => {
      return (
        <ConnectedOHIFDicomPDFViewer
          {...props}
          servicesManager={servicesManager}
          commandsManager={commandsManager}
          extensionManager={extensionManager}
        />
      );
    }
  },
};
