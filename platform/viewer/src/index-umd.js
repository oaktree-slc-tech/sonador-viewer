/**
 * Entry point index.js for UMD packaging
 */
import 'regenerator-runtime/runtime';

import React from 'react';
import ReactDOM from 'react-dom';
import App from './App.js';

import OHIFExtCornerstone from '@ohif/extension-cornerstone';
import OHIFVTKExtension from '@ohif/extension-vtk';
import OHIFDicomHtmlExtension from '@ohif/extension-dicom-html';
import OHIFDicomSegmentationExtension from '@ohif/extension-dicom-segmentation';
import OHIFDicomRtExtension from '@ohif/extension-dicom-rt';
import OHIFDicomMicroscopyExtension from '@ohif/extension-dicom-microscopy';
import OHIFDicomPDFExtension from '@ohif/extension-dicom-pdf';
import OHIFDicomTagBrowserExtension from '@ohif/extension-dicom-tag-browser';
import OHIFLesionTrackerExtension from '@ohif/extension-lesion-tracker';

function installViewer(config, containerId = 'root', callback) {
  const container = document.getElementById(containerId);
  const defaultExtensions = [
    OHIFExtCornerstone,
    OHIFVTKExtension,
    OHIFDicomHtmlExtension,
    OHIFDicomMicroscopyExtension,
    OHIFDicomPDFExtension,
    OHIFDicomSegmentationExtension,
    OHIFDicomRtExtension,
    OHIFDicomTagBrowserExtension,
    OHIFLesionTrackerExtension,
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
  OHIFExtCornerstone,
  OHIFVTKExtension,
  OHIFDicomHtmlExtension,
  OHIFDicomMicroscopyExtension,
  OHIFDicomPDFExtension,
  OHIFDicomSegmentationExtension,
  OHIFDicomRtExtension,
  OHIFDicomTagBrowserExtension,
  OHIFLesionTrackerExtension,
};
