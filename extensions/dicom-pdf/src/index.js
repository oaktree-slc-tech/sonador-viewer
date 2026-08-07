import _ from 'lodash';
import React from 'react';

import dicomPdfVersion from '../package.json';

import ConnectedOHIFDicomPDFViewport from './connectedComponents/ConnectedOHIFDicomPDFViewport.js';
import OHIFDicomPDFSopClassHandler from './OHIFDicomPDFSopClassHandler.js';


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
        <ConnectedOHIFDicomPDFViewport
          {...props}
          servicesManager={servicesManager}
          commandsManager={commandsManager}
          extensionManager={extensionManager}
        />
      );
    }
  },
};
