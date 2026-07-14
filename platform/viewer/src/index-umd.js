/**
 * Entry point index.js for UMD packaging
 */
import React from 'react';
import { createRoot } from 'react-dom/client';

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
import OHIFSegEditorExtension from '@ohif/extension-seg3d-editor';
import OHIFVTKExtension from '@ohif/extension-vtk';

import 'regenerator-runtime/runtime';

//  Add version for debugging purposes
import viewerPackage from '../package.json';

import App from './App.js';

function installViewer(config, containerId = 'root', callback) {
  const container = document.getElementById(containerId);

  if (!container) {
    throw new Error(
      "No root element found to install viewer. Please add a <div> with the id 'root', or pass a DOM element into the installViewer function."
    );
  }

  createRoot(container).render(<App config={config} />);
  if (callback) callback();
}
const version = viewerPackage.version;
export {
  App,
  installViewer,

  // Data management
  OHIFDicomHtmlExtension,
  OHIFDicomMicroscopyExtension,
  OHIFDicomPDFExtension,
  OHIFDicomSegmentationExtension,
  OHIFDicomRtExtension,

  // Metadata
  OHIFDicomTagBrowserExtension,

  // 3D visualization
  OHIFVTKExtension,
  OHIFDicomECGExtension,
  OHIF3DVolumeViewerExtension,
  OHIFSegEditorExtension,
  OHIFM3DViewerExtension,
  version,
};
