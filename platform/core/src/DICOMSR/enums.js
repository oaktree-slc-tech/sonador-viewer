// DICOM constants, data structures, and encoded concepts for Sonador.

// NOTE: Within Sonador, the convention is to use CodedConcept to refer to the names
// of categories of values and Code to refer to the values in a specific context group.
// This file represents the JavaScript / Cornerstone implementation of the schema.
// Refer to https://code.oak-tree.tech/oak-tree/medical-imaging/sonador-client/-/blob/master/apisettings/base.py?ref_type=heads
// for the Python implementation.

// Sonador schem versions (newer versions, unless explicitly noted, extended older revisions):
// * 0.1 (2022): basic encoding structures including "Sonador-SEG" and "Sonador-SR" structures
// * 0.2 (2023-0828): spatial SR constructs (2D/3D point concepts) used for creating SR documents 
//   that can be used for machine learning applications.
// * 0.3 (2025-0614): Sonador Viewer extensions establishing extended metadata attributes.


import _ from 'lodash';

import { adaptersSR } from '@cornerstonejs/adapters';

import TOOL_NAMES from './constants/toolNames.js';
import SCOORD_TYPES from './constants/scoordTypes';

import { sr } from 'dcmjs';

const { CodeScheme: Cornerstone3DCodeScheme } = adaptersSR.Cornerstone3D;


export const SCOORDTypes = _.pick(SCOORD_TYPES, 'POINT', 'MULTIPOINT', 'POLYLINE', 'CIRCLE', 'ELLIPSE');


export const CodeNameCodeSequenceValues = {
  ImagingMeasurementReport: '126000',
  ImageLibrary: '111028',
  ImagingMeasurements: '126010',
  MeasurementGroup: '125007',
  ImageLibraryGroup: '126200',
  TrackingUniqueIdentifier: '112040',
  TrackingIdentifier: '112039',
  Finding: '121071',
  FindingSite: 'G-C0E3', // SRT
  FindingSiteSCT: '363698007', // SCT
  CornerstoneFreeText: 'CORNERSTONEFREETEXT', // CST4
  Score: '246262008',
};


// Cornerstone and Sonador Manufacturer Concepts

export const CORNERSTONE_MANUFACTURER = 'Cornerstone';
export const CORNERSTONE_TOOLS_SOURCE_NAME = `${CORNERSTONE_MANUFACTURER}Tools`;
export const CORNERSTONE_TOOLS_SOURCE_VERSION = '4';

export const CORNERSTONE_3D_MANUFACTURER = 'Cornerstone3D';
export const CORNERSTONE_3D_TOOLS_SOURCE_NAME = `${CORNERSTONE_3D_MANUFACTURER}Tools-Sonador`;
export const CORNERSTONE_3D_TOOLS_SOURCE_VERSION = '0.1';


export const SONADOR_MANUFACTURER = 'Sonador';
export const HIGHDICOM_MANUFACTURER = 'HIGHDICOM';

export const SONADOR_PROJECT = `${SONADOR_MANUFACTURER} Project`;
export const SONADOR_VIEWER = `${SONADOR_MANUFACTURER} Viewer`;
export const SONADOR_MEASUREMENT_REPORT_SERIES_DESCRIPTION = 'Research Measurement Report';
export const SONADOR_DCMSR_DEVICE_NUMBER = 42;
export const SONADOR_DCMSR_CONTENT_QUALIFICATION = 'RESEARCH';

export const SONADOR_CLIENT = `${SONADOR_MANUFACTURER}-Client`;
export const SONADOR_SCHEME_VERSION_01 = '0.1';
export const SONADOR_SCHEME_VERSION_02 = '0.2';
export const SONADOR_SCHEME_VERSION_03 = '0.3';
export const SONADOR_SCHEME_VERSION = SONADOR_SCHEME_VERSION_03;

export const SONADOR_SEG = `${SONADOR_MANUFACTURER}-SEG`;
export const SONADOR_SEG_DESCRIPTION = `${SONADOR_SEG} implements tools for working with segmentation data`;
export const DCMSR_SONADOR_SEG = {
  value: SONADOR_SEG,
  schemeDesignator: SONADOR_CLIENT,
  meaning: SONADOR_SEG_DESCRIPTION,
  schemeVersion: SONADOR_SCHEME_VERSION,
}

export const SONADOR_SR = `${SONADOR_MANUFACTURER}-SR`;
export const DCM_SR_DCM_DESCRIPTION =  `${SONADOR_SR} implements tools for working with structured reporting data`;
export const DCMSR_SONADOR_SR = {
  value: SONADOR_SR,
  schemeDesignator: SONADOR_CLIENT,
  meaning: DCM_SR_DCM_DESCRIPTION,
  schemeVersion: SONADOR_SCHEME_VERSION,
}


// Sonador Spatial Data Types

export const SONADOR_SCOORD3D = `${SONADOR_MANUFACTURER}-Coord3D`;
export const SONADOR_SCOORD3D_DESCRIPTION = '3D spatial point (x,y,z)';
export const DCMSR_SCOORD3D = {
  value: SONADOR_SCOORD3D,
  schemeDesignator: DCMSR_SONADOR_SR.value,
  meaning: SONADOR_SCOORD3D_DESCRIPTION,
  schemeVersion: SONADOR_SCHEME_VERSION_02,
}

export const SONADOR_SCOORD3D_ANTOMIC  = `${SONADOR_MANUFACTURER}-Anatomic`;
export const SONADOR_SCOORD3D_ANTOMIC_DESCRIPTION = '3D coordinate (x,y,z) describing an antomic landmark (or landmarks).';
export const DCMSR_SCOORD3D_ANATOMIC = {
  value: SONADOR_SCOORD3D_ANTOMIC,
  schemeDesignator: DCMSR_SONADOR_SR.value,
  meaning: SONADOR_SCOORD3D_ANTOMIC_DESCRIPTION,
  schemeVersion: SONADOR_SCHEME_VERSION_02,
}

export const SONADOR_SCOORD3D_LANDMARK = `${SONADOR_MANUFACTURER}-Landmark`;
export const SONAODR_SCOORD3D_LANDMARK_DESCRIPTION = '3D coordinate describing a registration point (or points).';
export const DCMSR_SCOORD3D_LANDMARK = {
  value: SONADOR_SCOORD3D_LANDMARK,
  schemeDesignator: DCMSR_SONADOR_SR.value,
  meaning: SONAODR_SCOORD3D_LANDMARK_DESCRIPTION,
  schemeVersion: SONADOR_SCHEME_VERSION_02,
}

export const SONADOR_SCOORD3D_REGISTRATION = `${SONADOR_MANUFACTURER}-Registration`;
export const SONADOR_SCOORD3D_REGISTRATION_DESCRIPTION = '3D coordinate describing a registration point (or points).';
export const DCMSR_SCOORD3D_REGISTRATION = {
  value: SONADOR_SCOORD3D_REGISTRATION,
  schemeDesignator: DCMSR_SONADOR_SR.value,
  meaning: SONADOR_SCOORD3D_REGISTRATION_DESCRIPTION,
  schemeVersion: SONADOR_SCHEME_VERSION_02,
}


// Sonador Viewer Extended Metadata Attributes

// Attributes associatecd with the OHIF v3 MeasurementService Schema:

// * `description` (TEXT): free-text description of the measurement. Primary attribute of OHIF v3 schema.
// * `text` (TEXT): free-text description of the measurement contents, used as a secondary field to `description`.
//    Secondary attribute of measurement. Order of resolution: metadata, data, root.
// * `location` (TEXT): free-text field describing the "location" of the measurement. Secondary attribute of measurement.
//    Order of resoution: metadata, data, root.

export const MEASUREMENT_DESCRIPTION = `${SONADOR_MANUFACTURER}-Measurement.Description`;
export const MEASUREMENT_DESCRIPTION_MEANING = 'Free-text description of a measurement. Primary measurement attribute.';
export const DCMSR_MEASUREMENT_DESCRIPTION = {
  value: MEASUREMENT_DESCRIPTION,
  schemeDesignator: DCMSR_SONADOR_SR.value,
  meaning: MEASUREMENT_DESCRIPTION_MEANING,
  schemeVersion: SONADOR_SCHEME_VERSION_03,
}

export const MEASUREMENT_TEXT = `${SONADOR_MANUFACTURER}-Measurement.Text`;
export const MEASUREMENT_TEXT_MEANING = 'Free-text description of a measurement. Secondary measurement attribute.';
export const DCMSR_MEASUREMENT_TEXT = {
  value: MEASUREMENT_TEXT,
  schemeDesignator: DCMSR_SONADOR_SR.value,
  meaning: MEASUREMENT_TEXT_MEANING,
  schemeVersion: SONADOR_SCHEME_VERSION_03,
}

export const MEASUREMENT_LOCATION = `${SONADOR_MANUFACTURER}-Measurement.Location`;
export const MEASUREMENT_LOCATION_MEANING = 'Free-text field describing the "location" of the measurement. Secondary measurement attribute.';
export const DCMSR_MEASUREMENT_LOCATION = {
  value: MEASUREMENT_LOCATION,
  schemeDesignator: DCMSR_SONADOR_SR.value,
  meaning: MEASUREMENT_LOCATION_MEANING,
  schemeVersion: SONADOR_SCHEME_VERSION_03,
}


// Structured Export of Sonador Code Values

export const SonadorCodeValues = {
  SONADOR_MANUFACTURER,
  HIGHDICOM_MANUFACTURER,
  SONADOR_PROJECT,
  SONADOR_VIEWER,
  SONADOR_CLIENT,
  SONADOR_SCHEME_VERSION,

  DCMSR_SONADOR_SR,
  DCMSR_SONADOR_SEG,
  DCMSR_SCOORD3D,
  DCMSR_SCOORD3D_ANATOMIC,
  DCMSR_SCOORD3D_LANDMARK,
  DCMSR_SCOORD3D_REGISTRATION,
  DCMSR_MEASUREMENT_DESCRIPTION,
  DCMSR_MEASUREMENT_TEXT,
  DCMSR_MEASUREMENT_LOCATION,
}


export const RELATIONSHIP_TYPE = {
  CONTAINS: 'CONTAINS',
  INFERRED_FROM: 'INFERRED FROM',
  SELECTED_FROM: 'SELECTED FROM',
  CONCEPT_MOD: 'HAS CONCEPT MOD',
};
export const RelationshipType = RELATIONSHIP_TYPE;


export const CodingSchemeDesignators = {
  SRT: 'SRT',
  SCT: 'SCT',
  cornerstoneTools4: 'CST4',
  CornerstoneCodeSchemes: [Cornerstone3DCodeScheme.CodingSchemeDesignator, 'CST4'],
};


const Enums = {
  CORNERSTONE_TOOLS_SOURCE_NAME,
  CORNERSTONE_TOOLS_SOURCE_VERSION,
  CORNERSTONE_3D_TOOLS_SOURCE_NAME,
  CORNERSTONE_3D_TOOLS_SOURCE_VERSION,

  SONADOR_PROJECT,
  SONADOR_VIEWER,
  SONADOR_CLIENT,
  DCMSR_SONADOR_SR,
  DCMSR_SONADOR_SEG,

  SONADOR_MEASUREMENT_REPORT_SERIES_DESCRIPTION,
  SONADOR_DCMSR_DEVICE_NUMBER,
  SONADOR_DCMSR_CONTENT_QUALIFICATION,

  CodeNameCodeSequenceValues,
  CodingSchemeDesignators,
  SonadorCodeValues,
  RelationshipType,
  SCOORDTypes,

  RELATIONSHIP_TYPE,
  SCOORD_TYPES,
  TOOL_NAMES,
}


export default Enums;
export { Enums };