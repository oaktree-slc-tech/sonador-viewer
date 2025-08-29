// Cornerstone Legacy/Classic Adapters for Sonador.
// IMPORTANT: The measurement service within Sonador uses the Cornerstone 3D adapters to load
// SR data and the Classic / Legacy Cornerstone tools for creeating SR instance data.

// TODO: Refactor measurement service and bindings so that the Cornerstone 3D representation
// is used throughout the SR module rather than maintaining two separate adapters for working
// with the data.

import { utilities } from "dcmjs";

import { adaptersSR as c3dAdaptersSR, helpers as c3dSrHelpers } from '@cornerstonejs/adapters';

import { Enums as SREnums } from '../enums';
import TID300 from '../TID300';
import { MeasurementReport as CornerstoneLegacyMeasurementReport } from './MeasurementReport';


const { CORNERSTONE_TOOLS_SR_TAG } = SREnums;
const { DICOMReferencedSOPInstanceFinding: TID300DICOMReferencedSOPInstanceFinding } = TID300;


class DICOMSRSeriesTagTool {
	// DICOM SR adapter class which can be used for saving/parsing series tag data

	static getMeasurementData(MeasurementGroup) {
		// Retrieve DICOom SR Series Tag Data from the provided Measurement Group
		
		throw new Error('Cornerstone Legacy: Implement logic for retrieving measurement data');
	}

	static getTID300RepresentationArguments(tool) {
		// Encode Series Tag Data as SR instance

		// Unpack series tag values
		const { value, text, finding, findingSites } = tool;
		const { scheme, schemeVersion } = (tool.metadata || tool);		

		if (!value || !text) {

			// Log details of invalid data to console
			const emsg = 'Unable to save DICOM series tag data, invalid value or meaning.';
			console.error(emsg+' value="'+value+'" text="'+text+'"', tool);
			
			throw new Error(emsg);
		}

		return {
			value, text, finding, findingSites,
			scheme: scheme || SREnums.SONADOR_CLIENT, 
			schemeVersion: schemeVersion || SREnums.SONADOR_SCHEME_VERSION, 
			trackingIdentifierTextValue: [CORNERSTONE_TOOLS_SR_TAG, SREnums.TOOL_NAMES.DICOM_SR_SERIES_TAG].join(':'),
		};
	}
}


DICOMSRSeriesTagTool.toolType = SREnums.TOOL_NAMES.DICOM_SR_SERIES_TAG;
DICOMSRSeriesTagTool.utilityToolType = SREnums.TOOL_NAMES.DICOM_SR_SERIES_TAG;
DICOMSRSeriesTagTool.TID300Representation = TID300DICOMReferencedSOPInstanceFinding;
DICOMSRSeriesTagTool.isValidCornerstoneTrackingIdentifier = TrackingIdentifier => {
	// Ensure that the tracking identifier for the series tag is correct
  
  if (!TrackingIdentifier.includes(":")) {
    return false;
  }

  const [cornerstone4Tag, toolType] = TrackingIdentifier.split(":");

  if (cornerstone4Tag !== CORNERSTONE_TOOLS_SR_TAG) {
  	return false;
  }

  return toolType === SREnums.TOOL_NAMES.DICOM_SR_SERIES_TAG;
};


CornerstoneLegacyMeasurementReport.registerTool(DICOMSRSeriesTagTool);


// Adapter Module

const sonadorAdaptersSR = _.extend(c3dAdaptersSR.Cornerstone, {
	DICOMSRSeriesTagTool
});


export default sonadorAdaptersSR;
export { sonadorAdaptersSR, }