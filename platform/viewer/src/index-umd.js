/**
 * Entry point index.js for UMD packaging
 */
import 'regenerator-runtime/runtime';

import React from 'react';
import ReactDOM from 'react-dom';
import App from './App.js';

import OHIFVTKExtension from '@ohif/extension-vtk';
import OHIFDicomHtmlExtension from '@ohif/extension-dicom-html';
import OHIFDicomSegmentationExtension from '@ohif/extension-dicom-segmentation';
import OHIFDicomRtExtension from '@ohif/extension-dicom-rt';
import OHIFDicomMicroscopyExtension from '@ohif/extension-dicom-microscopy';
import OHIFDicomPDFExtension from '@ohif/extension-dicom-pdf';
import OHIFDicomTagBrowserExtension from '@ohif/extension-dicom-tag-browser';
import OHIFDicomECGExtension from '@ohif/extension-dicom-ecg';
import OHIF3DCTVolumeViewerExtension from '@ohif/extension-viewer3dct';

// OHIF Server Components
import { utils } from '@ohif/core';
import store from './store';

//  Add version for debugging purposes
import { version } from '../package.json';

function installViewer(config, containerId = 'root', callback) {
  const container = document.getElementById(containerId);
  const defaultExtensions = [
    OHIFDicomHtmlExtension,
    OHIFDicomMicroscopyExtension,
    OHIFDicomPDFExtension,
    OHIFDicomSegmentationExtension,
    OHIFDicomRtExtension,
    OHIFVTKExtension,
    OHIFDicomECGExtension,

    // 3D Volume Extensions
    OHIFVTKExtension,
    OHIF3DCTVolumeViewerExtension,

    // Metadata
    OHIFDicomTagBrowserExtension,
  ];

  if (!container) {
    throw new Error(
      "No root element found to install viewer. Please add a <div> with the id 'root', or pass a DOM element into the installViewer function."
    );
  }

  return ReactDOM.render(<App config={config} />, container, callback);
}

export {
  App,
  installViewer,
  OHIFVTKExtension,
  OHIFDicomHtmlExtension,
  OHIFDicomMicroscopyExtension,
  OHIFDicomPDFExtension,
  OHIFDicomSegmentationExtension,
  OHIFDicomRtExtension,
  OHIFDicomTagBrowserExtension,
  OHIF3DCTVolumeViewerExtension,
  OHIFDicomECGExtension,
  version,
};
