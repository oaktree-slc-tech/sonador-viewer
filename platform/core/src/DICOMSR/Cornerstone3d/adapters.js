// Cornerstone 3D Adapters for Sonador.
// IMPORTANT: The measurement service within Sonador uses the Cornerstone 3D adapters to load
// SR data and the Classic / Legacy Cornerstone tools for creating SR instance data.

// TODO: Refactor measurement service and bindings so that the Cornerstone 3D representation
// is used throughout the SR module rather than maintaining two separate adapters for working 
// with the data.

import _ from 'lodash';

import { utilities, data as dcmData } from "dcmjs";
import { adaptersSR as c3dAdaptersSR, helpers as c3dSrHelpers } from '@cornerstonejs/adapters';

import Enums from '../../measurements/enums';
import { readFindingCode } from '../TID300/DICOMReferencedSOPInstanceFinding';
import { asArray, conceptNameValue } from '../utils/codedConcept';

const { TID300Measurement } = utilities.TID300;
const { BaseAdapter3D } = c3dAdaptersSR.Cornerstone3D;
const { DicomMetaDictionary } = dcmData;

const { SREnums, Cornerstone3D } = Enums;


const DICOMSR_SERIES_TAG = SREnums.TOOL_NAMES.DICOM_SR_SERIES_TAG;

const trackingUID = MeasurementGroup => {
  const item = asArray(MeasurementGroup.ContentSequence).find(contentItem =>
    conceptNameValue(contentItem) === SREnums.CodeNameCodeSequenceValues.TrackingUniqueIdentifier);
  return item && item.UID;
};


class DICOMSRSeriesTagTool extends BaseAdapter3D {
  // DICOM SR adapter class which for saving/parsing series tag data

  static {
    this.init(DICOMSR_SERIES_TAG, TID300Measurement);

    // Register using Cornerstone 1.x name so the tool is used to load those annotations
    this.registerLegacy();
  }

  static getMeasurementData(MeasurementGroup, 
      sopInstanceUIDToImageIdMap, metadata, trackingIdentifierValue, options) {
    // Retrieve the DICOM SR Series Tag Data from the provided Measurement Group

    options = options || {};
    _.defaults(options, {
      isReadOnly: true,
      isLocked: true,
    });
    
    // Retrieve finding group, base tool state, and UID references
    const {
      findingGroup, findings, state, ReferencedSOPSequence, ReferencedSOPInstanceUID, ReferencedFrameNumber, referencedImageId,
    } = Cornerstone3D.sr.measurementReport.getQualitativeEvaluationData(
      MeasurementGroup, sopInstanceUIDToImageIdMap, metadata, this.toolType);

    const TrackingUniqueIdentifier = trackingUID(MeasurementGroup);
    const findingCode = readFindingCode(findingGroup, TrackingUniqueIdentifier);
    if (!findingCode) {
      throw new Error('Unable to parse DICOM series tag data, invalid ConceptCodeSequence');
    }
    const { value, text, scheme, schemeVersion } = findingCode;

    // Add data to tool/annotation state
    _.extend(state.annotation.data, { value, text });
    state.annotation.metadata.scheme = scheme;
    state.annotation.metadata.schemeVersion = schemeVersion;
    state.annotation.metadata.TrackingUniqueIdentifier = TrackingUniqueIdentifier;
    state.annotation.metadata.isReadOnly = options.isReadOnly;
    state.annotation.metadata.isLocked = options.isLocked;

    console.debug('[DICOMSR:TID300:DICOMSRSeriesTagTool:getMeasurementData] toolType='+this.toolType+' state', state);
    return state;
  }

  static getTID300RepresentationArguments(tool, is3DMeasurement = false) {
    // Encode Series Tag Data as SR Instance

    throw new Error('TODO: Implement logic for encoding Series Tag as SR instance');
  }
}


// Adapter Module

const sonadorAdaptersSR = _.extend(c3dAdaptersSR.Cornerstone3D, {
  DICOMSRSeriesTagTool,
});


export default sonadorAdaptersSR;
export { sonadorAdaptersSR, DICOMSRSeriesTagTool };