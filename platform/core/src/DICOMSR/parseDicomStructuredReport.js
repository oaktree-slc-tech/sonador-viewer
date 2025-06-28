// Helper methods used for parsing DICOM-SR reports to OHIF measurement instances
// which can be displayed by the Sonador Viewer. This module uses the OHIF v3
// "Measurements Service" to manage the metadata lifecycle and aims to be broadly
// compatible with the OHIF v3 classes used for creating, displaying, and persisting
// DICOM measurements to SR.
//
// The primary method of the module is `parseDicomStructuredReport`, which takes a 
// part10SRArrayBuffer, parses it to a structured report instance, registers the 
// the metadata with the measurements service, and returns a grouped set of measurement
// instances for display. `parseDicomStructuredReport` utilizes the OHIF v3 `DicomMetadataStore`
// and Cornerstone3D adapters to manage parsing of data.
//
// The method can be toggled between a version which uses Cornerstone 3D compatible
// components and a version which falls back to parsing methods provided by Cornerstone Tools
// Legacy/Classic. The Cornerstone 3D version writes all data to the measurement service.
// The Cornerstone Tools Classic returns an iterable of data which is persisted
// to local Measurements API state.

import _ from 'lodash';
import dcmjs from 'dcmjs';

import cornerstone from 'cornerstone-core';

import {
  utilities as c3dCoreUtilities, 
  metaData as c3dCoreMetaData
} from '@cornerstonejs/core';
import { adaptersSR as c3dAdaptersSR } from '@cornerstonejs/adapters';

import { DicomMetadataStore } from '../services/DicomMetadataStore';
import { fileLoader } from '../store';

import Enums from '../measurements/enums';
import getImagePath from '../measurements/lib/getImagePath';

import MeasurementApi from '../measurements/classes/MeasurementApi';

import initDisplaySetMeasurements from './utils/initDisplaySetMeasurements';
import parseSCOORD3D from './SCOORD3D/parseSCOORD3D';
import findInstanceMetadataBySopInstanceUID from './utils/findInstanceMetadataBySopInstanceUid';

import { Cornerstone3D as Cornerstone3dDcmSrParse } from './Cornerstone3d';
import { Cornerstone as CornerstoneDcmSrParse } from './SCOORD3D';


const {
  CORNERSTONE_TOOLS_SOURCE_NAME, CORNERSTONE_TOOLS_SOURCE_VERSION, Cornerstone: CornerstoneSR,
  CORNERSTONE_3D_TOOLS_SOURCE_NAME, CORNERSTONE_3D_TOOLS_SOURCE_VERSION, Cornerstone3D: Cornerstone3dSR,
} = Enums;


const parseDicomStructuredReport = async (part10SRArrayBuffer, displaySets, external, options) => {
  // Function to parse the part10 array buffer that comes from a DICOM Structured report into measurementData
  // that can be consumed by the OHIF measurement service. This method utilizes the Cornerstone compatibility 
  // classes available in Cornerstone3D to parse measurements while also reading the dicomSR file
  // to locate "CodedConcept" instances and free-text associated with measurements.
  
  options = options || {};
  _.defaults(options, {
    parseReadOnly: false,
    renderModule: CornerstoneSR.sr,
    parserModule: Cornerstone3dSR.sr,
  });

  // Retrieve references to services and API
  const { LoggerService, UINotificationService, displaySetService } = external.servicesManager.services;
  const measurementApi = MeasurementApi.Instance;
  const measurementService = measurementApi.measurementService;

  try {

    // Parse read-only annotations from the DICOM-SR file.
    parseSCOORD3D({ servicesManager: external.servicesManager, displaySets });

  } catch(err) {

    // Parse DICOM-SR document to retrieve details for error
    const dicomData = dcmjs.data.DicomMessage.readFile(part10SRArrayBuffer);
    const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomData.dict);
    const seriesDescription = dataset.SeriesDescription || '';
    
    // Log error details and notify user of failure
    LoggerService.error({ error: err, message: err.message });

    UINotificationService.show({
      title: `Failed to parse ${seriesDescription} SR display set`,
      message: err.message,
      type: 'error',
      autoClose: false,
    });
  }

  if (options.parserModule.name == Cornerstone3dSR.sr.name && options.parserModule.version == Cornerstone3dSR.sr.version) {

    // Parse measurements via Cornerstone 3D
    return Cornerstone3dDcmSrParse.parseDicomStructuredReport(part10SRArrayBuffer, displaySets, external, options);

  } else if (options.parserModule.name == CornerstoneSR.sr.name && options.parserModule.version == CornerstoneSR.sr.version) {

    // Parse measurements via Cornerstone Tools (Legacy/Classic)
    return CornerstoneDcmSrParse.parseDicomStructuredReport(part10SRArrayBuffer, displaySets, external, options);

  }

  throw new Error('Unsupported DICOM-SR parsing module. sourceName='+options.parserModule.name
    +' sourceVersion='+options.parserModule.version);
}


export default parseDicomStructuredReport;
