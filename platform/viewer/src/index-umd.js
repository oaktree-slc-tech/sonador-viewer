/**
 * Entry point index.js for UMD packaging
 */
import React from 'react';
import ReactDOM from 'react-dom';

// OHIF Server Components
import OHIFDicomECGExtension from '@ohif/extension-dicom-ecg';
import OHIFDicomHtmlExtension from '@ohif/extension-dicom-html';
import OHIFDicomMicroscopyExtension from '@ohif/extension-dicom-microscopy';
import OHIFDicomPDFExtension from '@ohif/extension-dicom-pdf';
import OHIFDicomRtExtension from '@ohif/extension-dicom-rt';
import OHIFDicomSegmentationExtension from '@ohif/extension-dicom-segmentation';
import OHIFDicomTagBrowserExtension from '@ohif/extension-dicom-tag-browser';
import OHIF3DVolumeViewerExtension from '@ohif/extension-viewer3d-volume';
import OHIFM3DViewerExtension from '@ohif/extension-viewerm3d';
import OHIFVTKExtension from '@ohif/extension-vtk';

import 'regenerator-runtime/runtime';

//  Add version for debugging purposes
import { version } from '../package.json';

import App from './App.js';

function installViewer(config, containerId = 'root', callback) {
  const container = document.getElementById(containerId);
  const defaultExtensions = [
    OHIFDicomHtmlExtension,
    OHIFDicomMicroscopyExtension,
    OHIFDicomPDFExtension,
    OHIFDicomSegmentationExtension,
    OHIFDicomRtExtension,
    OHIFDicomECGExtension,

    // 3D Volume Extensions
    OHIFVTKExtension,
    OHIF3DVolumeViewerExtension,
    OHIFM3DViewerExtension,

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
  OHIF3DVolumeViewerExtension,
  OHIFDicomECGExtension,
  OHIFM3DViewerExtension,
  version,
};
