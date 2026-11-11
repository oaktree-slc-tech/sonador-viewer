// DICOM constants, data structures, and encoded concepts for Sonador.

// NOTE: Within Sonador, the convention is to use CodedConcept to refer to the names
// of categories of values and Code to refer to the values in a specific context group.
// This file represents the JavaScript / Cornerstone implementation of the schema.
// Refer to https://code.oak-tree.tech/oak-tree/medical-imaging/sonador-client/-/blob/master/apisettings/base.py?ref_type=heads
// for the Python implementation.

// Sonador scheme versions (newer versions, unless explicitly noted, extend older revisions):
// * 0.1 (2022): basic encoding structures including "Sonador-SEG" and "Sonador-SR" structures
// * 0.2 (2023-0828): spatial SR constructs (2D/3D point concepts) used for creating SR documents 
//   that can be used for machine learning applications.
// * 0.3 (2025-0614): Sonador Viewer extensions establishing extended metadata attributes and the
//   display attributes. There is no 0.4: display-attribute concept names in files written with
//   0.4 are read as the same concepts (readers match on the code value).


import _ from 'lodash';

import { adaptersSR } from '@cornerstonejs/adapters';

import TOOL_NAMES from './constants/toolNames.js';
import SCOORD_TYPES from './constants/scoordTypes';

import { sr } from 'dcmjs';

const { CodeScheme: Cornerstone3DCodeScheme } = adaptersSR.Cornerstone3D;


export const SCOORDTypes = _.pick(SCOORD_TYPES, 'POINT', 'MULTIPOINT', 'POLYLINE', 'CIRCLE', 'ELLIPSE');


export const DCM = 'DCM';
export const SNOMED_CT = 'SCT';
export const SRT = 'SRT';

export const DCMSR_NUM = 'NUM';
export const DCMSR_IMAGE = 'IMAGE';

export const CodeNameCodeSequenceValues = {
  DCM, SNOMED_CT, SRT,
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

const DCMSR_FINDING = {
  CodingSchemeDesignator: DCM,
  CodeValue: CodeNameCodeSequenceValues.Finding,
}
const DCMSR_FINDING_SITE = {
  CodingSchemeDesignator: SNOMED_CT,
  CodeValue: CodeNameCodeSequenceValues.FindingSiteSCT,
}
const DCMSR_FINDING_SITE_OLD = {
  CodingSchemeDesignator: SRT, 
  CodeValue: CodeNameCodeSequenceValues.FindingSite,
}


// Cornerstone and Sonador Manufacturer Concepts

export const CORNERSTONE_MANUFACTURER = 'Cornerstone';
export const CORNERSTONE_TOOLS_SOURCE_NAME = `${CORNERSTONE_MANUFACTURER}Tools`;
export const CORNERSTONE_TOOLS_SOURCE_VERSION = '4';
export const CORNERSTONE_TOOLS_SR_TAG = 'cornerstoneTools@^4.0.0';

export const CORNERSTONE_3D_MANUFACTURER = 'Cornerstone3D';
export const CORNERSTONE_3D_TOOLS_SOURCE_NAME = `${CORNERSTONE_3D_MANUFACTURER}Tools-Sonador`;
export const CORNERSTONE_3D_TOOLS_SOURCE_VERSION = '0.1';
// Tracking identifier prefix written by the Cornerstone3D adapters (accepted on read)
export const CORNERSTONE_3D_TAG = 'Cornerstone3DTools@^0.1.0';


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

// * `view` (TEXT, one item per view): the view a measurement was created in (MEASUREMENT_VIEWS).
//    Descriptive only, a label used to navigate to a measurement, never a rule for whether it is
//    drawn; values are kept as read, unknown ones included.

export const MEASUREMENT_VIEW = `${SONADOR_MANUFACTURER}-Measurement.View`;
export const MEASUREMENT_VIEW_MEANING = 'View a measurement was created in. Descriptive measurement attribute.';
export const DCMSR_MEASUREMENT_VIEW = {
  value: MEASUREMENT_VIEW,
  schemeDesignator: DCMSR_SONADOR_SR.value,
  meaning: MEASUREMENT_VIEW_MEANING,
  schemeVersion: SONADOR_SCHEME_VERSION_03,
}

// View values (Sonador-SR 0.3), the same registry as the Sonador IO client's: each value is a string
// constant, which is also its code value and the text written into the document (the encoding
// stays TEXT; the codes are the formal registry and are not written as CODE items). The meanings
// are interface text, used wherever the Viewer names a view.
export const MEASUREMENT_VIEW_AXIAL = 'axial';
export const MEASUREMENT_VIEW_SAGITTAL = 'sagittal';
export const MEASUREMENT_VIEW_CORONAL = 'coronal';
export const MEASUREMENT_VIEW_OBLIQUE = 'oblique';
export const MEASUREMENT_VIEW_3D = '3d';

const measurementViewCode = (value, meaning) => Object.freeze({
  value, schemeDesignator: DCMSR_SONADOR_SR.value, meaning, schemeVersion: SONADOR_SCHEME_VERSION_03,
});

export const DCMSR_MEASUREMENT_VIEW_AXIAL = measurementViewCode(
  MEASUREMENT_VIEW_AXIAL, 'Axial view. Cross-sections, dividing head from feet.');
export const DCMSR_MEASUREMENT_VIEW_SAGITTAL = measurementViewCode(
  MEASUREMENT_VIEW_SAGITTAL, 'Sagittal view. Side-on slices, dividing left from right.');
export const DCMSR_MEASUREMENT_VIEW_CORONAL = measurementViewCode(
  MEASUREMENT_VIEW_CORONAL, 'Coronal view. Front-on slices, dividing front from back.');
export const DCMSR_MEASUREMENT_VIEW_OBLIQUE = measurementViewCode(
  MEASUREMENT_VIEW_OBLIQUE, 'Oblique view. A slice tilted away from the standard views.');
export const DCMSR_MEASUREMENT_VIEW_3D = measurementViewCode(
  MEASUREMENT_VIEW_3D, '3D view. The whole volume, seen from any direction.');

export const MEASUREMENT_VIEWS = Object.freeze([
  MEASUREMENT_VIEW_AXIAL, MEASUREMENT_VIEW_SAGITTAL, MEASUREMENT_VIEW_CORONAL, MEASUREMENT_VIEW_OBLIQUE, MEASUREMENT_VIEW_3D,
]);
export const MEASUREMENT_VIEW_CODES = Object.freeze({
  [MEASUREMENT_VIEW_AXIAL]: DCMSR_MEASUREMENT_VIEW_AXIAL,
  [MEASUREMENT_VIEW_SAGITTAL]: DCMSR_MEASUREMENT_VIEW_SAGITTAL,
  [MEASUREMENT_VIEW_CORONAL]: DCMSR_MEASUREMENT_VIEW_CORONAL,
  [MEASUREMENT_VIEW_OBLIQUE]: DCMSR_MEASUREMENT_VIEW_OBLIQUE,
  [MEASUREMENT_VIEW_3D]: DCMSR_MEASUREMENT_VIEW_3D,
});

// * `source-series` (UIDREF, under the NUM item of a patient-domain measurement): the imaging
//    series the measurement was made on, which its Frame of Reference does not name. Descriptive
//    only, never a rule for where it is drawn; absent on image-domain measurements.
export const MEASUREMENT_SOURCE_SERIES = `${SONADOR_MANUFACTURER}-Measurement.Source-Series`;
export const DCMSR_MEASUREMENT_SOURCE_SERIES = {
  value: MEASUREMENT_SOURCE_SERIES,
  schemeDesignator: DCMSR_SONADOR_SR.value,
  meaning: 'Imaging series a patient-domain measurement was made on',
  schemeVersion: SONADOR_SCHEME_VERSION_03,
}

// * `drawing-plane` (TEXT, under the NUM item of an out-of-plane measurement): the orientation of
//    the view the measurement was drawn in, six comma-separated direction cosines in the layout of
//    Image Orientation (Patient), width direction then height direction (utils/drawingPlane.js).
export const MEASUREMENT_DRAWING_PLANE = `${SONADOR_MANUFACTURER}-Measurement.Drawing-Plane`;
export const DCMSR_MEASUREMENT_DRAWING_PLANE = {
  value: MEASUREMENT_DRAWING_PLANE,
  schemeDesignator: DCMSR_SONADOR_SR.value,
  meaning: 'Orientation of the view a measurement was drawn in',
  schemeVersion: SONADOR_SCHEME_VERSION_03,
}

// * `construction-points` (SCOORD / SCOORD3D POLYLINE of three points, under a circle's NUM):
//    auxiliary data the primary geometry does not need. Not drawn, never read as Cornerstone3D
//    control points; kept with its NUM.
export const MEASUREMENT_CONSTRUCTION_POINTS = `${SONADOR_MANUFACTURER}-Measurement.ConstructionPoints`;
export const DCMSR_MEASUREMENT_CONSTRUCTION_POINTS = {
  value: MEASUREMENT_CONSTRUCTION_POINTS,
  schemeDesignator: DCMSR_SONADOR_SR.value,
  meaning: 'Points a circle was constructed from',
  schemeVersion: SONADOR_SCHEME_VERSION_03,
}


// Sonador Viewer Display Attributes

// Properties which control how a measurement is rendered, written as children of the Finding:
// a `DisplayAttributes` CONTAINER holding a `Color` CONTAINER with one TEXT item per color role
// (Comprehensive 3D SR), or the role TEXT items directly (Enhanced SR, which permits no CONTAINER
// under a CODE item). SR content items cannot carry RecommendedDisplayCIELabValue, so each TEXT
// value is the DICOM CIELab triple (`L\a\b`, 0-65535). The code values exceed 16 characters
// and are written as LongCodeValue.

const displayAttributeCode = (value, meaning) => ({
  value: `${SONADOR_MANUFACTURER}-${value}`,
  schemeDesignator: DCMSR_SONADOR_SR.value,
  meaning,
  schemeVersion: SONADOR_SCHEME_VERSION_03,
});

export const DCMSR_DISPLAY_ATTRIBUTES = displayAttributeCode('DisplayAttributes', 'Display attributes');
export const DCMSR_DISPLAY_COLOR = displayAttributeCode('DisplayAttributes.Color', 'Display color');
export const DCMSR_DISPLAY_COLOR_ROLES = {
  Background: displayAttributeCode('DisplayAttributes.Color.Background', 'Background color (CIELab)'),
  Border: displayAttributeCode('DisplayAttributes.Color.Border', 'Border color (CIELab)'),
  Value: displayAttributeCode('DisplayAttributes.Color.Value', 'Coded value color (CIELab)'),
  Meaning: displayAttributeCode('DisplayAttributes.Color.Meaning', 'Code meaning color (CIELab)'),
};


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
  DCMSR_MEASUREMENT_VIEW,
  DCMSR_MEASUREMENT_SOURCE_SERIES,
  DCMSR_MEASUREMENT_DRAWING_PLANE,
  DCMSR_MEASUREMENT_CONSTRUCTION_POINTS,
  DCMSR_DISPLAY_ATTRIBUTES,
  DCMSR_DISPLAY_COLOR,
  DCMSR_DISPLAY_COLOR_ROLES,
}


export const RELATIONSHIP_TYPE = {
  CONTAINS: 'CONTAINS',
  INFERRED_FROM: 'INFERRED FROM',
  SELECTED_FROM: 'SELECTED FROM',
  CONCEPT_MOD: 'HAS CONCEPT MOD',
  HAS_PROPERTIES: 'HAS PROPERTIES',
  HAS_OBS_CONTEXT: 'HAS OBS CONTEXT',
};
export const RelationshipType = RELATIONSHIP_TYPE;


// Document class and root template of a Viewer save (the Series-Tag exchange profile with Sonador
// IO). New documents are Comprehensive 3D SR with the Sonador root template; a re-save keeps the
// parent's class and template.
// Kind of SR document, by its root concept name (code value and coding scheme designator):
// `(126000, DCM, "Imaging Measurement Report")` is an exchange document, which the Viewer hydrates,
// edits and saves; a root concept in the Sonador-SR scheme is an application document, which also
// carries content the Viewer does not model. Any other root concept holds no measurements for the
// Viewer.
export const SR_DOCUMENT_KIND = Object.freeze({ EXCHANGE: 'exchange', APPLICATION: 'application', OTHER: 'other' });

export const SR_DOCUMENT_CLASS = {
  COMPREHENSIVE_3D: 'Comprehensive3DSR',
  ENHANCED: 'EnhancedSR',
};
// Form of the per-finding display attributes: nested under a container (Comprehensive 3D SR) or
// flat role items (Enhanced SR)
export const DISPLAY_LAYOUT = Object.freeze({ NESTED: 'nested', FLAT: 'flat' });
// Item that carries a measurement's properties (description, text, location, view, display
// attributes): the Finding of a group that has one, or the NUM item of a quantitative tool
export const PROPERTY_PARENT = Object.freeze({ FINDING: 'finding', NUM: 'num' });

export const SONADOR_SR_TEMPLATE = Object.freeze({
  TemplateIdentifier: `${SONADOR_SR}.1500`,
  MappingResource: SONADOR_SR,
});
export const DCMR_SR_TEMPLATE = Object.freeze({ TemplateIdentifier: '1500', MappingResource: 'DCMR' });
export const SR_TEMPLATE_IDENTIFIERS = [SONADOR_SR_TEMPLATE.TemplateIdentifier, DCMR_SR_TEMPLATE.TemplateIdentifier];

// Equipment written by the Viewer; the Device Observer mirrors it
export const SONADOR_VIEWER_MODEL_NAME = `${SONADOR_MANUFACTURER}-Viewer`;

// Observation context (TID 1002 / 1003 / 1004)
export const ObserverContextCodes = {
  ObserverType: { value: '121005', meaning: 'Observer Type', schemeDesignator: DCM },
  Person: { value: '121006', meaning: 'Person', schemeDesignator: DCM },
  Device: { value: '121007', meaning: 'Device', schemeDesignator: DCM },
  PersonObserverName: { value: '121008', meaning: 'Person Observer Name', schemeDesignator: DCM },
  DeviceObserverUID: { value: '121012', meaning: 'Device Observer UID', schemeDesignator: DCM },
  DeviceObserverName: { value: '121013', meaning: 'Device Observer Name', schemeDesignator: DCM },
  DeviceObserverManufacturer: { value: '121014', meaning: 'Device Observer Manufacturer', schemeDesignator: DCM },
  DeviceObserverModelName: { value: '121015', meaning: 'Device Observer Model Name', schemeDesignator: DCM },
};


export const CodingSchemeDesignators = {
  DCM,
  SRT,
  SCT: SNOMED_CT,
  cornerstoneTools4: 'CST4',
  CornerstoneCodeSchemes: [Cornerstone3DCodeScheme.CodingSchemeDesignator, 'CST4'],
};


const Enums = {
  DCM,
  DCMSR_FINDING,
  DCMSR_FINDING_SITE,
  DCMSR_FINDING_SITE_OLD,
  DCMSR_NUM,
  DCMSR_IMAGE,

  CORNERSTONE_TOOLS_SOURCE_NAME,
  CORNERSTONE_TOOLS_SOURCE_VERSION,
  CORNERSTONE_TOOLS_SR_TAG,
  CORNERSTONE_3D_TOOLS_SOURCE_NAME,
  CORNERSTONE_3D_TOOLS_SOURCE_VERSION,
  CORNERSTONE_3D_TAG,

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

  SR_DOCUMENT_CLASS,
  SR_DOCUMENT_KIND,
  MEASUREMENT_VIEWS,
  MEASUREMENT_VIEW_CODES,
  DISPLAY_LAYOUT,
  PROPERTY_PARENT,
  SONADOR_SR_TEMPLATE,
  DCMR_SR_TEMPLATE,
  SR_TEMPLATE_IDENTIFIERS,
  SONADOR_MANUFACTURER,
  SONADOR_VIEWER_MODEL_NAME,
  ObserverContextCodes,

  RELATIONSHIP_TYPE,
  SCOORD_TYPES,
  TOOL_NAMES,
}


export default Enums;
export { Enums };