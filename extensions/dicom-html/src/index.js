import React from 'react';

import OHIF from '@ohif/core';

import dicomHtmlVersion from '../package.json';

import OHIFDicomHtmlSopClassHandler from './OHIFDicomHtmlSopClassHandler.js';
import OHIFCornerstoneSRViewport from './components/OHIFCornerstoneSRViewport';

const { display } = OHIF;


const OHIFDicomHtmlViewport = (props) => {
  // OHIF Viewport able to render DICOM-SR documents to HTML

  const { displaySetService } = display.DisplaySetApi.Instance;
  const { viewportData } = props;
  const { displaySet: srDisplaySet } = viewportData;

  return (
    <React.Suspense fallback={<div>Loading...</div>}>
      <OHIFCornerstoneSRViewport 
        displaySets={displaySetService.getDisplaySetsForSeries(srDisplaySet.SeriesInstanceUID)}
        {...props} 
      />
    </React.Suspense>
  );
};

export default {
  /**
   * Only required property. Should be a unique value across all extensions.
   */
  id: 'html',
  version: dicomHtmlVersion.version,

  getViewportModule({ servicesManager, commandsManager, }) {
    // DICOM-SR rendering viewport

    const ExtendedOHIFDicomHtmlViewport = props => {
      return <OHIFDicomHtmlViewport
          servicesManager={servicesManager} commandsManager={commandsManager} {...props}
        />
    }
    
    return ExtendedOHIFDicomHtmlViewport;
  },
  getSopClassHandlerModule() {
    return OHIFDicomHtmlSopClassHandler;
  },
};
